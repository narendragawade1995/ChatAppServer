const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "http://localhost:3000",
        methods: ["GET", "POST"]
    }
});

// Middleware
app.use(cors());
app.use(express.json());

// Store connected users and their socket IDs
const connectedUsers = new Map();
const userRooms = new Map(); // Store private rooms between users
const messageHistory = new Map(); // Store message history for each room

// Helper function to create a unique room ID for two users
const createRoomId = (user1, user2) => {
    return [user1, user2].sort().join('-');
};

// Helper function to get message history for a room
const getMessageHistory = (roomId) => {
    if (!messageHistory.has(roomId)) {
        messageHistory.set(roomId, []);
    }
    return messageHistory.get(roomId);
};

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    // Handle user login
    socket.on('user_login', (userData) => {
        const { username, avatar } = userData;
        
        // Store user information
        connectedUsers.set(socket.id, {
            id: socket.id,
            username,
            avatar: avatar || `https://ui-avatars.com/api/?name=${username}&background=random`,
            status: 'online',
            lastSeen: new Date()
        });

        // Join user to their personal room
        socket.join(socket.id);

        // Send updated user list to all clients
        const userList = Array.from(connectedUsers.values()).filter(user => user.id !== socket.id);
        socket.emit('user_list', userList);
        socket.broadcast.emit('user_joined', connectedUsers.get(socket.id));

        console.log(`User ${username} connected with ID: ${socket.id}`);
    });

    // Handle getting user list
    socket.on('get_users', () => {
        const userList = Array.from(connectedUsers.values()).filter(user => user.id !== socket.id);
        socket.emit('user_list', userList);
    });

    // Handle private message
    socket.on('private_message', (data) => {
        const { recipientId, message, timestamp } = data;
        const sender = connectedUsers.get(socket.id);
        
        if (!sender) return;

        // Create room ID for these two users
        const roomId = createRoomId(socket.id, recipientId);
        
        // Create message object
        const messageObj = {
            id: uuidv4(),
            senderId: socket.id,
            senderUsername: sender.username,
            recipientId,
            message,
            timestamp: timestamp || new Date().toISOString(),
            type: 'private'
        };

        // Store message in history
        const history = getMessageHistory(roomId);
        history.push(messageObj);

        // Send to recipient if they're online
        if (connectedUsers.has(recipientId)) {
            socket.to(recipientId).emit('private_message', messageObj);
        }

        // Send confirmation back to sender
        socket.emit('message_sent', messageObj);

        console.log(`Private message from ${sender.username} to ${recipientId}: ${message}`);
    });

    // Handle getting message history between two users
    socket.on('get_message_history', (data) => {
        const { otherUserId } = data;
        const roomId = createRoomId(socket.id, otherUserId);
        const history = getMessageHistory(roomId);
        
        socket.emit('message_history', {
            otherUserId,
            messages: history
        });
    });

    // Handle typing indicator
    socket.on('typing_start', (data) => {
        const { recipientId } = data;
        const sender = connectedUsers.get(socket.id);
        
        if (sender && connectedUsers.has(recipientId)) {
            socket.to(recipientId).emit('user_typing', {
                userId: socket.id,
                username: sender.username
            });
        }
    });

    socket.on('typing_stop', (data) => {
        const { recipientId } = data;
        
        if (connectedUsers.has(recipientId)) {
            socket.to(recipientId).emit('user_stop_typing', {
                userId: socket.id
            });
        }
    });

    // Handle user status update
    socket.on('update_status', (status) => {
        const user = connectedUsers.get(socket.id);
        if (user) {
            user.status = status;
            user.lastSeen = new Date();
            
            // Broadcast status update to all users
            socket.broadcast.emit('user_status_update', {
                userId: socket.id,
                status,
                lastSeen: user.lastSeen
            });
        }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
        const user = connectedUsers.get(socket.id);
        
        if (user) {
            console.log(`User ${user.username} disconnected`);
            
            // Update user status to offline
            user.status = 'offline';
            user.lastSeen = new Date();
            
            // Notify other users
            socket.broadcast.emit('user_left', {
                userId: socket.id,
                username: user.username,
                lastSeen: user.lastSeen
            });
            
            // Remove user from connected users after a delay (in case of reconnection)
            setTimeout(() => {
                connectedUsers.delete(socket.id);
            }, 5000);
        }
    });

    // Handle connection errors
    socket.on('error', (error) => {
        console.error('Socket error:', error);
    });
});

// API Routes
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        connectedUsers: connectedUsers.size,
        uptime: process.uptime()
    });
});

app.get('/api/users', (req, res) => {
    const users = Array.from(connectedUsers.values());
    res.json(users);
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Socket.io server is ready for connections`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('Process terminated');
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    server.close(() => {
        console.log('Process terminated');
    });
});
 