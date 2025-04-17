const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs'); // Added for rate limiting and message persistence
const { v4: uuidv4 } = require('uuid');

// Rate limiting and message persistence
const userMessageTimestamps = new Map();
const messageHistory = new Map();
const MAX_MESSAGES_PER_ROOM = 50;

// Store messages with IDs
const messages = new Map();
let messageIdCounter = 1;

// Load reports and users data
let reportsData = { reports: [], users: {} };
try {
    reportsData = JSON.parse(fs.readFileSync('reports.json', 'utf8'));
} catch (err) {
    console.log('No existing reports.json, starting fresh');
}

// Save reports data
function saveReportsData() {
    fs.writeFileSync('reports.json', JSON.stringify(reportsData, null, 2));
}

// Admin users (add your admin usernames here)
const adminUsers = new Set(['admin']);

function isRateLimited(userId) {
    const now = Date.now();
    const userTimestamps = userMessageTimestamps.get(userId) || [];
    
    // Clean up old timestamps
    const recentTimestamps = userTimestamps.filter(ts => now - ts < 10000); // Last 10 seconds
    
    // Check if user has sent more than 10 messages in last 10 seconds
    if (recentTimestamps.length >= 10) {
        return true;
    }
    
    // Update timestamps
    recentTimestamps.push(now);
    userMessageTimestamps.set(userId, recentTimestamps);
    return false;
}

function addMessageToHistory(roomName, message) {
    if (!messageHistory.has(roomName)) {
        messageHistory.set(roomName, []);
    }
    
    const roomHistory = messageHistory.get(roomName);
    roomHistory.push(message);
    
    // Keep only last MAX_MESSAGES_PER_ROOM messages
    if (roomHistory.length > MAX_MESSAGES_PER_ROOM) {
        roomHistory.shift();
    }
}

// Add this function near the top with other functions
function isUserBanned(username) {
    for (const userData of Object.values(reportsData.users)) {
        if (userData.username === username && userData.banned) {
            return true;
        }
    }
    return false;
}

// Configure multer for image uploads
const storage = multer.diskStorage({
    destination: 'public/uploads/',
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({
    storage: storage,
    limits: { fileSize: 5000000 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        const filetypes = /jpeg|jpg|png|gif/;
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = filetypes.test(file.mimetype);
        if (extname && mimetype) {
            return cb(null, true);
        } else {
            cb('Error: Images only!');
        }
    }
});

app.use(cors());
app.use(express.static('public'));
app.use(express.json());

// Create uploads directory if it doesn't exist
if (!fs.existsSync('public/uploads')) {
    fs.mkdirSync('public/uploads', { recursive: true });
}

const users = new Map();
const rooms = new Map(); // Store room information: { name, password, users }

// Initialize default room
rooms.set('main', {
    name: 'Main Room',
    password: null,
    users: new Set()
});

// Handle image uploads
app.post('/upload', upload.single('image'), (req, res) => {
    if (req.file) {
        res.json({ 
            success: true, 
            filename: `/uploads/${req.file.filename}`
        });
    } else {
        res.status(400).json({ success: false });
    }
});

io.on('connection', (socket) => {
    console.log('A user connected');

    // Handle room creation
    socket.on('createRoom', ({ roomName, password }) => {
        if (rooms.has(roomName)) {
            socket.emit('roomError', { message: 'Room already exists' });
            return;
        }

        rooms.set(roomName, {
            name: roomName,
            password: password || null,
            users: new Set()
        });

        // Broadcast updated room list to all clients
        io.emit('roomList', Array.from(rooms.entries()).map(([name, room]) => ({
            name,
            hasPassword: !!room.password
        })));
    });

    socket.on('join', ({ username, room, password }) => {
        // Check if user is banned
        if (isUserBanned(username)) {
            socket.emit('error', { message: 'You are banned from the chat.' });
            return;
        }

        const roomData = rooms.get(room);
        
        if (!roomData) {
            socket.emit('roomError', { message: 'Room does not exist' });
            return;
        }

        if (roomData.password && roomData.password !== password) {
            socket.emit('roomError', { message: 'Incorrect password' });
            return;
        }

        // Leave current room if any
        const currentRoom = Array.from(socket.rooms).find(r => r !== socket.id);
        if (currentRoom) {
            const currentRoomData = rooms.get(currentRoom);
            if (currentRoomData) {
                currentRoomData.users.delete(username);
                io.to(currentRoom).emit('userLeft', {
                    username,
                    message: `${username} left ${currentRoom}`,
                    room: currentRoom
                });
                socket.leave(currentRoom);
            }
        }

        // Generate or get user ID
        let userId = null;
        for (const [id, userData] of Object.entries(reportsData.users)) {
            if (userData.username === username) {
                userId = id;
                break;
            }
        }
        if (!userId) {
            userId = uuidv4();
            reportsData.users[userId] = {
                username,
                createdAt: new Date().toISOString(),
                isAdmin: adminUsers.has(username),
                banned: false
            };
            saveReportsData();
        }

        // Store user data in socket session
        const userData = {
            username,
            room,
            userId,
            isAdmin: reportsData.users[userId].isAdmin
        };
        users.set(socket.id, userData);

        // Join new room
        socket.join(room);
        roomData.users.add(username);
        
        // Send user data including admin status
        socket.emit('userData', {
            userId,
            isAdmin: userData.isAdmin
        });

        // Send room history to the user
        const roomHistory = messageHistory.get(room) || [];
        socket.emit('messageHistory', roomHistory);

        // Send room users list with admin status
        const roomUsers = Array.from(roomData.users).map(username => ({
            username,
            isAdmin: Object.values(reportsData.users).some(u => u.username === username && u.isAdmin),
            banned: isUserBanned(username)
        }));
        
        io.to(room).emit('roomUsers', roomUsers);
        io.to(room).emit('userJoined', { 
            username, 
            message: `${username} joined ${room}`,
            room
        });

        // Send current room list to all users
        io.emit('roomList', Array.from(rooms.entries()).map(([name, room]) => ({
            name,
            hasPassword: !!room.password
        })));
    });

    socket.on('chat message', (data) => {
        const user = users.get(socket.id);
        if (!user) return;

        // Apply rate limiting
        if (isRateLimited(socket.id)) {
            socket.emit('error', { message: 'You are sending messages too quickly. Please wait a moment.' });
            return;
        }

        // Process message for mentions
        const mentionRegex = /@(\w+)/g;
        const mentions = data.message.match(mentionRegex) || [];
        const messageId = messageIdCounter++;
        
        const processedMessage = {
            id: messageId,
            username: user.username,
            message: data.message,
            timestamp: new Date().toLocaleTimeString(),
            mentions: mentions.map(m => m.substring(1)),
            type: data.type || 'text',
            imageUrl: data.imageUrl || null,
            room: user.room
        };

        // Store message
        messages.set(messageId, processedMessage);

        // Add message to history
        addMessageToHistory(user.room, processedMessage);

        // Send message to room
        io.to(user.room).emit('chat message', processedMessage);
    });

    // Add message editing handler
    socket.on('editMessage', (data) => {
        const user = users.get(socket.id);
        if (!user) return;

        const message = messages.get(data.messageId);
        if (!message || message.username !== user.username) {
            socket.emit('error', { message: 'Cannot edit this message' });
            return;
        }

        // Update message
        message.message = data.newText;
        message.edited = true;
        message.editedAt = new Date().toLocaleTimeString();

        // Broadcast the edit
        io.to(user.room).emit('messageEdited', {
            messageId: data.messageId,
            newText: data.newText,
            editedAt: message.editedAt
        });
    });

    // Add message deletion handler
    socket.on('deleteMessage', (data) => {
        const user = users.get(socket.id);
        if (!user) return;

        const message = messages.get(data.messageId);
        if (!message || message.username !== user.username) {
            socket.emit('error', { message: 'Cannot delete this message' });
            return;
        }

        // Delete message
        messages.delete(data.messageId);

        // Remove from room history
        const roomHistory = messageHistory.get(user.room) || [];
        const messageIndex = roomHistory.findIndex(m => m.id === data.messageId);
        if (messageIndex !== -1) {
            roomHistory.splice(messageIndex, 1);
        }

        // Broadcast the deletion
        io.to(user.room).emit('messageDeleted', {
            messageId: data.messageId
        });
    });

    // Handle message reports
    socket.on('reportMessage', ({ messageId, reason, reportedUsername }) => {
        const reporter = users.get(socket.id);
        if (!reporter) return;

        const report = {
            id: uuidv4(),
            messageId,
            reportedUsername,
            reporterUsername: reporter.username,
            reason,
            timestamp: new Date().toISOString(),
            status: 'pending'
        };

        reportsData.reports.push(report);
        saveReportsData();

        // Notify admins in the room
        const room = reporter.room;
        socket.to(room).emit('newReport', {
            reportId: report.id,
            messageId,
            reportedUsername,
            reason
        });
    });

    // Admin actions
    socket.on('adminAction', ({ action, targetId, targetUsername }) => {
        const admin = users.get(socket.id);
        if (!admin || !reportsData.users[admin.userId]?.isAdmin) {
            socket.emit('error', { message: 'Unauthorized action' });
            return;
        }

        switch (action) {
            case 'deleteMessage':
                io.to(admin.room).emit('forceDeleteMessage', { messageId: targetId });
                break;
            case 'banUser':
                const targetUser = Object.values(reportsData.users).find(u => u.username === targetUsername);
                if (targetUser) {
                    targetUser.banned = true;
                    saveReportsData();
                    io.emit('userBanned', { username: targetUsername });
                }
                break;
            case 'resolveReport':
                const report = reportsData.reports.find(r => r.id === targetId);
                if (report) {
                    report.status = 'resolved';
                    report.resolvedBy = admin.username;
                    report.resolvedAt = new Date().toISOString();
                    saveReportsData();
                }
                break;
        }
    });

    socket.on('disconnect', () => {
        const user = users.get(socket.id);
        if (user) {
            const { username, room } = user;
            users.delete(socket.id);
            
            const roomData = rooms.get(room);
            if (roomData) {
                roomData.users.delete(username);
                // Delete room if empty (except main room)
                if (roomData.users.size === 0 && room !== 'main') {
                    rooms.delete(room);
                    io.emit('roomList', Array.from(rooms.entries()).map(([name, room]) => ({
                        name,
                        hasPassword: !!room.password
                    })));
                } else {
                    io.to(room).emit('roomUsers', Array.from(roomData.users));
                }
            }
            
            io.to(room).emit('userLeft', { 
                username, 
                message: `${username} left ${room}`,
                room
            });
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});