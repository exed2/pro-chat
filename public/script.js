const socket = io();

const loginScreen = document.getElementById('login-screen');
const chatContainer = document.getElementById('chat-container');
const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const usernameInput = document.getElementById('username-input');
const roomInput = document.getElementById('room-input');
const roomPasswordInput = document.getElementById('room-password-input');
const createRoomBtn = document.getElementById('create-room-btn');
const joinBtn = document.getElementById('join-btn');
const fileInput = document.getElementById('file-input');
const uploadBtn = document.getElementById('upload-btn');
const imagePreview = document.getElementById('image-preview');
const imagePreviewContainer = document.getElementById('image-preview-container');
const cancelUploadBtn = document.getElementById('cancel-upload-btn');
const rulesToggle = document.getElementById('rules-toggle');
const rulesPanel = document.getElementById('rules-panel');
const closeRules = document.getElementById('close-rules');
const onlineUsersList = document.getElementById('online-users-list');
const roomsList = document.getElementById('rooms-list');
const roomNameDisplay = document.getElementById('room-name-display');
const createRoomPanel = document.getElementById('create-room-panel');
const showCreateRoomBtn = document.getElementById('show-create-room-btn');
const cancelCreateRoomBtn = document.getElementById('cancel-create-room-btn');
const passwordToggle = document.getElementById('password-toggle');
const toggleUsersBtn = document.getElementById('toggle-users-btn');
const closeSidebarBtn = document.getElementById('close-sidebar');
const usersSidebar = document.getElementById('users-sidebar');
const emojiBtn = document.getElementById('emoji-btn');
const emojiPicker = document.getElementById('emoji-picker');
const cooldownTimer = document.getElementById('cooldown-timer');
const contextMenu = document.getElementById('context-menu');
const reportDialog = document.getElementById('report-dialog');
const reportReason = document.getElementById('report-reason');
const reportDetails = document.getElementById('report-details');
const submitReport = document.getElementById('submit-report');
const cancelReport = document.getElementById('cancel-report');
const adminPanel = document.getElementById('admin-panel');
const closeAdminPanel = document.getElementById('close-admin-panel');
const reportsList = document.getElementById('reports-list');
const adminUsersList = document.getElementById('admin-users-list');

// Add loading and TOS variables
const loadingScreen = document.getElementById('loading-screen');
const tosOverlay = document.getElementById('tos-overlay');
const tosCheckbox = document.getElementById('tos-checkbox');
const acceptTosBtn = document.getElementById('accept-tos');

// Local storage key for TOS agreement
const TOS_AGREED_KEY = 'prochat_tos_agreed';

let username = '';
let currentRoom = 'main';
let currentImageFile = null;
let lastMessageTime = 0;
let currentUserId = null;
let isAdmin = false;
let selectedMessageId = null;
let selectedMessageUsername = null;
const SPAM_THRESHOLD = 1000; // 1 second between messages to prevent spam

const commonEmojis = ['😊', '😂', '🥰', '😎', '🤔', '😅', '👍', '❤️', '🎉', '🔥', '👀', '💡', '🌟', '💪', '🙌', '✨'];

function initEmojiPicker() {
    emojiPicker.innerHTML = commonEmojis.map(emoji => 
        `<button class="emoji-btn" data-emoji="${emoji}">${emoji}</button>`
    ).join('');

    // Fix emoji click handlers
    emojiPicker.querySelectorAll('.emoji-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const emoji = e.currentTarget.dataset.emoji;
            const cursorPos = messageInput.selectionStart;
            messageInput.value = messageInput.value.slice(0, cursorPos) + emoji + messageInput.value.slice(cursorPos);
            messageInput.focus();
            emojiPicker.style.display = 'none';
            e.stopPropagation();
        });
    });
}

// Initialize emoji picker when the page loads
initEmojiPicker();

// Toggle emoji picker
emojiBtn.addEventListener('click', () => {
    emojiPicker.style.display = emojiPicker.style.display === 'none' ? 'grid' : 'none';
});

// Close emoji picker when clicking outside
document.addEventListener('click', (event) => {
    if (!emojiPicker.contains(event.target) && event.target !== emojiBtn) {
        emojiPicker.style.display = 'none';
    }
});

function updateCooldownTimer() {
    const timeLeft = SPAM_THRESHOLD - (Date.now() - lastMessageTime);
    if (timeLeft > 0) {
        cooldownTimer.textContent = `${(timeLeft / 1000).toFixed(1)}s`;
        cooldownTimer.style.display = 'block';
        setTimeout(updateCooldownTimer, 100);
    } else {
        cooldownTimer.style.display = 'none';
    }
}

function sendMessage() {
    const message = messageInput.value.trim();
    const currentTime = Date.now();
    
    // Spam prevention with visual feedback
    if (currentTime - lastMessageTime < SPAM_THRESHOLD) {
        updateCooldownTimer();
        return;
    }
    
    if (message || currentImageFile) {
        if (currentImageFile) {
            // Upload image first
            const formData = new FormData();
            formData.append('image', currentImageFile);
            
            fetch('/upload', {
                method: 'POST',
                body: formData
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    // Send message with image URL
                    socket.emit('chat message', { 
                        message: message,
                        type: 'image',
                        imageUrl: data.filename
                    });
                    
                    // Reset image preview
                    resetImageUpload();
                    lastMessageTime = currentTime;
                    updateCooldownTimer();
                }
            })
            .catch(error => {
                console.error('Error uploading image:', error);
                alert('Failed to upload image. Please try again.');
            });
        } else {
            // Send text-only message
            socket.emit('chat message', { message });
            lastMessageTime = currentTime;
            updateCooldownTimer();
        }
        
        messageInput.value = '';
    }
}

function formatTimestamp(timestamp) {
    const date = new Date();
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}

function appendMessage(data, type = 'normal') {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    
    let content = '';
    
    if (type === 'system' || type === 'system error') {
        content = `<span class="${type === 'system error' ? 'error-text' : ''}">${data.message}</span>
                  <span class="timestamp">${data.timestamp}</span>`;
    } else {
        // Process message text for mentions
        let messageText = data.message;
        if (data.mentions && data.mentions.length > 0) {
            data.mentions.forEach(mention => {
                const mentionRegex = new RegExp(`@${mention}`, 'g');
                const isCurrentUser = mention === username;
                messageText = messageText.replace(
                    mentionRegex,
                    `<span class="mention ${isCurrentUser ? 'mention-self' : ''}"">@${mention}</span>`
                );
                
                if (isCurrentUser && data.username !== username) {
                    showNotification(`${data.username} mentioned you`);
                }
            });
        }

        const isOwnMessage = data.username === username;
        const messageActions = isOwnMessage ? `
            <div class="message-actions">
                <button class="edit-msg-btn" title="Edit message">✎</button>
                <button class="delete-msg-btn" title="Delete message">🗑️</button>
            </div>
        ` : '';

        content = `
            <div class="message-header">
                <span class="username">${data.username}</span>
                <span class="timestamp">${formatTimestamp(data.timestamp)}</span>
                ${messageActions}
            </div>
            <div class="message-content">
                <span class="message-text" data-message-id="${data.id}">${messageText}</span>
                ${data.imageUrl ? `<div><img src="${data.imageUrl}" class="message-image" alt="Shared image"></div>` : ''}
            </div>`;
    }
    
    messageDiv.innerHTML = content;

    // Add event listeners for edit and delete buttons if it's user's own message
    if (data.username === username && type === 'normal') {
        const editBtn = messageDiv.querySelector('.edit-msg-btn');
        const deleteBtn = messageDiv.querySelector('.delete-msg-btn');
        const messageTextElem = messageDiv.querySelector('.message-text');

        if (editBtn) {
            editBtn.addEventListener('click', () => {
                startEditingMessage(messageTextElem, data.id, data.message);
            });
        }

        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => {
                if (confirm('Are you sure you want to delete this message?')) {
                    socket.emit('deleteMessage', { messageId: data.id, room: currentRoom });
                }
            });
        }
    }

    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Add message editing functionality
function startEditingMessage(messageElement, messageId, originalText) {
    const editInput = document.createElement('input');
    editInput.type = 'text';
    editInput.value = originalText;
    editInput.className = 'edit-message-input';
    
    messageElement.style.display = 'none';
    messageElement.parentNode.insertBefore(editInput, messageElement);
    editInput.focus();

    function saveEdit() {
        const newText = editInput.value.trim();
        if (newText && newText !== originalText) {
            socket.emit('editMessage', {
                messageId,
                newText,
                room: currentRoom
            });
        }
        cancelEdit();
    }

    function cancelEdit() {
        editInput.remove();
        messageElement.style.display = '';
    }

    editInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            saveEdit();
        } else if (e.key === 'Escape') {
            cancelEdit();
        }
    });

    editInput.addEventListener('blur', cancelEdit);
}

// Function to show desktop notification
function showNotification(message) {
    if (Notification.permission === "granted") {
        new Notification("Pro Chat", { body: message });
    } else if (Notification.permission !== "denied") {
        Notification.requestPermission().then(permission => {
            if (permission === "granted") {
                new Notification("Pro Chat", { body: message });
            }
        });
    }
}

joinBtn.addEventListener('click', () => {
    username = usernameInput.value.trim();
    if (username) {
        // Join the main room by default
        socket.emit('join', { username, room: 'main' });
    } else {
        alert('Please enter a username');
    }
});

sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

function resetImageUpload() {
    currentImageFile = null;
    imagePreviewContainer.style.display = 'none';
    imagePreview.src = '';
    fileInput.value = '';
}

socket.on('chat message', (data) => {
    appendMessage(data);
});

// Update room state management
function switchRoom(newRoom) {
    // Only update if actually changing rooms
    if (currentRoom !== newRoom) {
        messagesDiv.innerHTML = '';
        currentRoom = newRoom;
        roomNameDisplay.textContent = newRoom;
    }
}

// Update joinRoom function to handle room switching better
function joinRoom(roomName) {
    username = usernameInput.value.trim();
    if (!username) {
        alert('Please enter a username first');
        usernameInput.focus();
        return;
    }

    // Let the server handle the room validation
    const roomData = roomsList.querySelector(`[data-room="${roomName}"]`);
    const hasPassword = roomData && roomData.dataset.hasPassword === 'true';
    
    if (hasPassword) {
        const password = prompt('Enter room password:');
        if (password === null) return; // User canceled
        socket.emit('join', { username, room: roomName, password });
    } else {
        socket.emit('join', { username, room: roomName });
    }
}

// Update the room click handler
function handleRoomJoinClick(e) {
    if (e.target.classList.contains('join-room-btn')) {
        e.preventDefault();
        const roomName = e.target.dataset.room;
        if (!roomName) return;
        
        joinRoom(roomName);
    }
}

// Update socket.on('userJoined') handler
socket.on('userJoined', (data) => {
    if (data.username === username) {
        switchRoom(data.room);
        loginScreen.style.display = 'none';
        chatContainer.style.display = 'flex';
        messageInput.focus();
    }
    appendMessage(data, 'system');
});

socket.on('userLeft', (data) => {
    appendMessage(data, 'system');
});

// Image upload handling
fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file && file.type.startsWith('image/')) {
        currentImageFile = file;
        
        // Show image preview
        const reader = new FileReader();
        reader.onload = function(event) {
            imagePreview.src = event.target.result;
            imagePreviewContainer.style.display = 'block';
        };
        reader.readAsDataURL(file);
    }
});

cancelUploadBtn.addEventListener('click', resetImageUpload);

// Make upload button clickable
uploadBtn.addEventListener('click', () => {
    fileInput.click();
});

// Rules panel toggle functionality
rulesToggle.addEventListener('click', () => {
    rulesPanel.style.display = rulesPanel.style.display === 'block' ? 'none' : 'block';
});

closeRules.addEventListener('click', () => {
    rulesPanel.style.display = 'none';
});

// Close rules panel when clicking outside of it
document.addEventListener('click', (event) => {
    if (!rulesPanel.contains(event.target) && event.target !== rulesToggle) {
        rulesPanel.style.display = 'none';
    }
});

// Room creation handling
showCreateRoomBtn.addEventListener('click', () => {
    username = usernameInput.value.trim(); // Get the latest username value
    if (!username) {
        alert('Please enter a username first');
        usernameInput.focus();
        return;
    }
    createRoomPanel.style.display = 'block';
});

cancelCreateRoomBtn.addEventListener('click', () => {
    createRoomPanel.style.display = 'none';
    roomInput.value = '';
    roomPasswordInput.value = '';
    passwordToggle.checked = false;
});

passwordToggle.addEventListener('change', (e) => {
    roomPasswordInput.style.display = e.target.checked ? 'block' : 'none';
});

createRoomBtn.addEventListener('click', () => {
    const roomName = roomInput.value.trim();
    const password = passwordToggle.checked ? roomPasswordInput.value : null;
    
    if (roomName) {
        if (!username) {
            alert('Please enter a username first');
            return;
        }
        socket.emit('createRoom', { roomName, password });
        createRoomPanel.style.display = 'none';
        roomInput.value = '';
        roomPasswordInput.value = '';
        passwordToggle.checked = false;
    } else {
        alert(' enter a room name');
    }
});

// Join room handling
document.addEventListener('DOMContentLoaded', () => {
    // Initialize main room join button
    const mainRoomBtn = document.querySelector('[data-room="main"]');
    if (mainRoomBtn) {
        mainRoomBtn.onclick = () => joinRoom('main');
    }
});

// Update the roomList handler to remove onclick attribute and use proper event delegation
socket.on('roomList', (rooms) => {
    roomsList.innerHTML = rooms.map(room => `
        <div class="room-item" data-room="${room.name}" data-has-password="${room.hasPassword}">
            <span>${room.name}</span>
            <button class="join-room-btn" data-room="${room.name}">${currentRoom === room.name ? 'Current' : 'Join'}</button>
        </div>
    `).join('');
});

// Remove old event listeners and implement new ones
document.removeEventListener('click', handleRoomJoinClick);
document.addEventListener('click', handleRoomJoinClick);

// Handle room list updates
socket.on('roomError', (data) => {
    alert(data.message);
});

// Update the roomUsers socket handler
socket.on('roomUsers', (users) => {
    onlineUsersList.innerHTML = users.map(user => `
        <li class="user-item ${user.username === username ? 'current-user' : ''} ${user.isAdmin ? 'admin' : ''} ${user.banned ? 'banned' : ''}">
            ${user.username}
            ${user.isAdmin ? '<span class="admin-badge" title="Admin">👑</span>' : ''}
            ${user.banned ? '<span class="banned-badge" title="Banned">🚫</span>' : ''}
        </li>
    `).join('');
});

// Sidebar toggle functionality for mobile devices
toggleUsersBtn.addEventListener('click', () => {
    usersSidebar.classList.add('active');
});

closeSidebarBtn.addEventListener('click', () => {
    usersSidebar.classList.remove('active');
});

// Close sidebar when clicking outside on mobile
document.addEventListener('click', (event) => {
    if (window.innerWidth <= 768) {
        const isClickInside = usersSidebar.contains(event.target) || toggleUsersBtn.contains(event.target);
        if (!isClickInside && usersSidebar.classList.contains('active')) {
            usersSidebar.classList.remove('active');
        }
    }
});

// Add these socket listeners with the other ones
socket.on('messageHistory', (messages) => {
    // Clear existing messages
    messagesDiv.innerHTML = '';
    // Add each message from history
    messages.forEach(msg => appendMessage(msg));
});

socket.on('error', (data) => {
    // Show error as a system message
    appendMessage({
        message: data.message,
        timestamp: new Date().toLocaleTimeString()
    }, 'system error');
});

socket.on('messageEdited', (data) => {
    const messageElem = document.querySelector(`[data-message-id="${data.messageId}"]`);
    if (messageElem) {
        messageElem.innerHTML = data.newText;
        messageElem.innerHTML += `<span class="edited-tag" title="Edited at ${data.editedAt}"> (edited)</span>`;
    }
});

socket.on('messageDeleted', (data) => {
    const messageElem = document.querySelector(`[data-message-id="${data.messageId}"]`);
    if (messageElem) {
        const messageContainer = messageElem.closest('.message');
        if (messageContainer) {
            messageContainer.style.animation = 'fadeOut 0.3s ease-in-out';
            setTimeout(() => messageContainer.remove(), 300);
        }
    }
});

// Context menu handling
document.addEventListener('contextmenu', (e) => {
    const messageElem = e.target.closest('.message');
    if (messageElem) {
        e.preventDefault();
        const messageId = messageElem.querySelector('.message-text').dataset.messageId;
        const messageUsername = messageElem.querySelector('.username').textContent;
        
        selectedMessageId = messageId;
        selectedMessageUsername = messageUsername;

        // Show/hide edit and delete options based on ownership
        const editOption = contextMenu.querySelector('.edit-option');
        const deleteOption = contextMenu.querySelector('.delete-option');
        const isOwnMessage = messageUsername === username;
        
        editOption.style.display = isOwnMessage || isAdmin ? 'block' : 'none';
        deleteOption.style.display = isOwnMessage || isAdmin ? 'block' : 'none';

        // Position context menu
        contextMenu.style.display = 'block';
        const x = e.clientX;
        const y = e.clientY;
        
        // Adjust menu position if it would go off screen
        const menuWidth = contextMenu.offsetWidth;
        const menuHeight = contextMenu.offsetHeight;
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        
        if (x + menuWidth > windowWidth) {
            contextMenu.style.left = (windowWidth - menuWidth) + 'px';
        } else {
            contextMenu.style.left = x + 'px';
        }
        
        if (y + menuHeight > windowHeight) {
            contextMenu.style.top = (windowHeight - menuHeight) + 'px';
        } else {
            contextMenu.style.top = y + 'px';
        }
    }
});

// Hide context menu when clicking outside
document.addEventListener('click', (e) => {
    if (!contextMenu.contains(e.target)) {
        contextMenu.style.display = 'none';
    }
});

// Handle context menu actions
contextMenu.querySelector('.edit-option').addEventListener('click', () => {
    const messageElem = document.querySelector(`[data-message-id="${selectedMessageId}"]`);
    if (messageElem) {
        startEditingMessage(messageElem, selectedMessageId, messageElem.textContent);
    }
    contextMenu.style.display = 'none';
});

contextMenu.querySelector('.delete-option').addEventListener('click', () => {
    if (confirm('Are you sure you want to delete this message?')) {
        socket.emit('deleteMessage', { messageId: selectedMessageId, room: currentRoom });
    }
    contextMenu.style.display = 'none';
});

contextMenu.querySelector('.report-option').addEventListener('click', () => {
    if (selectedMessageUsername === username) {
        alert('You cannot report your own message');
        return;
    }
    reportDialog.style.display = 'flex';
    contextMenu.style.display = 'none';
});

// Report dialog handling
submitReport.addEventListener('click', () => {
    const reason = reportReason.value;
    if (!reason) {
        alert('Please select a reason for the report');
        return;
    }

    socket.emit('reportMessage', {
        messageId: selectedMessageId,
        reason: reason,
        details: reportDetails.value,
        reportedUsername: selectedMessageUsername
    });

    reportDialog.style.display = 'none';
    reportReason.value = '';
    reportDetails.value = '';
});

cancelReport.addEventListener('click', () => {
    reportDialog.style.display = 'none';
    reportReason.value = '';
    reportDetails.value = '';
});

// Admin panel functionality
function updateAdminPanel() {
    if (!isAdmin) return;

    // Add admin button to header if not exists
    const headerRight = document.querySelector('.header-right');
    if (!headerRight.querySelector('#admin-btn')) {
        const adminBtn = document.createElement('button');
        adminBtn.id = 'admin-btn';
        adminBtn.className = 'admin-btn';
        adminBtn.title = 'Admin Panel';
        adminBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
                <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z" fill="currentColor"/>
            </svg>
        `;
        adminBtn.addEventListener('click', () => {
            adminPanel.style.display = adminPanel.style.display === 'none' ? 'flex' : 'none';
        });
        headerRight.insertBefore(adminBtn, headerRight.firstChild);
    }
}

closeAdminPanel.addEventListener('click', () => {
    adminPanel.style.display = 'none';
});

// Add these functions for admin notifications
function showAdminNotification() {
    const adminBtn = document.getElementById('admin-btn');
    if (adminBtn) {
        adminBtn.classList.add('has-notifications');
    }
}

function clearAdminNotification() {
    const adminBtn = document.getElementById('admin-btn');
    if (adminBtn) {
        adminBtn.classList.remove('has-notifications');
    }
}

// Handle admin socket events
socket.on('userData', (data) => {
    currentUserId = data.userId;
    isAdmin = data.isAdmin;
    if (isAdmin) {
        updateAdminPanel();
    }
});

socket.on('newReport', (data) => {
    if (isAdmin) {
        const reportElement = document.createElement('div');
        reportElement.className = 'report-item';
        reportElement.dataset.reportId = data.reportId;
        reportElement.innerHTML = `
            <div class="report-info">
                <strong>Reported User: ${data.reportedUsername}</strong>
                <span>Reason: ${data.reason}</span>
                <span class="report-details">${data.details || ''}</span>
                <span class="report-timestamp">Reported: ${new Date().toLocaleString()}</span>
            </div>
            <div class="report-actions">
                <button onclick="handleReportAction('delete', '${data.messageId}', '${data.reportedUsername}')">Delete Message</button>
                <button onclick="handleReportAction('ban', '${data.messageId}', '${data.reportedUsername}')">Ban User</button>
                <button onclick="handleReportAction('resolve', '${data.reportId}', '${data.reportedUsername}')">Resolve</button>
            </div>
        `;
        reportsList.prepend(reportElement);
        
        // Show notification if admin panel is not visible
        if (adminPanel.style.display !== 'flex') {
            showAdminNotification();
        }
    }
});

// Clear notification when opening admin panel
document.querySelector('#admin-btn')?.addEventListener('click', () => {
    clearAdminNotification();
});

socket.on('userBanned', (data) => {
    if (data.username === username) {
        alert('You have been banned from the chat.');
        window.location.reload();
    }
});

socket.on('forceDeleteMessage', (data) => {
    const messageElem = document.querySelector(`[data-message-id="${data.messageId}"]`);
    if (messageElem) {
        const messageContainer = messageElem.closest('.message');
        if (messageContainer) {
            messageContainer.style.animation = 'fadeOut 0.3s ease-in-out';
            setTimeout(() => messageContainer.remove(), 300);
        }
    }
});

function handleReportAction(action, targetId, targetUsername) {
    switch(action) {
        case 'delete':
            socket.emit('adminAction', { 
                action: 'deleteMessage', 
                targetId 
            });
            break;
        case 'ban':
            if (confirm(`Are you sure you want to ban ${targetUsername}?`)) {
                socket.emit('adminAction', { 
                    action: 'banUser', 
                    targetUsername 
                });
            }
            break;
        case 'resolve':
            socket.emit('adminAction', { 
                action: 'resolveReport', 
                targetId 
            });
            const reportItem = document.querySelector(`[data-report-id="${targetId}"]`);
            if (reportItem) {
                reportItem.classList.add('resolved');
            }
            break;
    }
}

// Handle TOS checkbox
tosCheckbox.addEventListener('change', () => {
    acceptTosBtn.disabled = !tosCheckbox.checked;
});

// Handle TOS acceptance
acceptTosBtn.addEventListener('click', () => {
    if (tosCheckbox.checked) {
        localStorage.setItem(TOS_AGREED_KEY, 'true');
        tosOverlay.style.display = 'none';
        loginScreen.style.display = 'flex';
    }
});

// Add loading screen functions
function hideLoadingScreen() {
    const loadingScreen = document.getElementById('loading-screen');
    loadingScreen.style.opacity = '0';
    setTimeout(() => {
        loadingScreen.style.display = 'none';
        // Show login or TOS based on agreement status
        if (localStorage.getItem(TOS_AGREED_KEY) === 'true') {
            loginScreen.style.display = 'flex';
        } else {
            tosOverlay.style.display = 'flex';
        }
    }, 500); // Match this with CSS transition duration
}

// Update the window load event handler
window.addEventListener('load', () => {
    // Hide all main content initially
    loginScreen.style.display = 'none';
    chatContainer.style.display = 'none';
    tosOverlay.style.display = 'none';
    
    // Add connection status check
    socket.on('connect', () => {
        setTimeout(hideLoadingScreen, 1000);
    });

    socket.on('connect_error', () => {
        const loadingText = document.querySelector('#loading-screen h2');
        if (loadingText) {
            loadingText.textContent = 'Connection error. Retrying...';
        }
    });
});
