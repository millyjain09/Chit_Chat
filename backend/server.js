const express = require("express");
const connectDB = require("./config/db");
const dotenv = require("dotenv");
const colors = require("colors");
const cors = require("cors");
const userRoutes = require("./routes/userRoutes");
const chatRoutes = require("./routes/chatRoutes");
const messageRoutes = require("./routes/messageRoutes");
const { notFound, errorHandler } = require("./middleware/errorMiddleware");
const path = require("path");

dotenv.config();

connectDB();

const app = express();

// CORS Config
app.use(cors({
  origin: ["http://localhost:3000", "http://127.0.0.1:3000"],
  credentials: true,
}));

app.use(express.json());

// Uploads folder (agar use kar rahe ho)
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

// Routes
app.use("/api/user", userRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/message", messageRoutes);

// Deployment
const __dirname1 = path.resolve();

if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(__dirname1, "frontend", "build")));

  app.get("*", (req, res) =>
    res.sendFile(path.resolve(__dirname1, "frontend", "build", "index.html"))
  );
} else {
  app.get("/", (req, res) => {
    res.send("API is running..");
  });
}


// Error Handling
app.use(notFound);
app.use(errorHandler);

const port = process.env.PORT || 5000;
const server = app.listen(
  port,
  console.log(`Server running on PORT ${port}...`.yellow.bold)
);

// ---------- SOCKET.IO SETUP ----------
const io = require("socket.io")(server, {
  pingTimeout: 60000,
  cors: {
    origin: ["http://localhost:3000", "http://127.0.0.1:3000"],
    credentials: true,
  },
});

// Map to track online users: userId -> socketId
let onlineUsers = new Map();

io.on("connection", (socket) => {
  console.log("✅ Socket connected:", socket.id);

  // 1. Setup User
  socket.on("setup", (userData) => {
    socket.join(userData._id);
    socket.userId = userData._id;
    
    // Add to online users
    onlineUsers.set(userData._id, socket.id);
    // Broadcast updated list to everyone
    io.emit("user online", Array.from(onlineUsers.keys()));
    
    socket.emit("connected");
  });

  // 2. Join Chat Room
  socket.on("join chat", (room) => {
    socket.join(room);
  });

  // 3. Typing Indicators
  socket.on("typing", (room) => socket.to(room).emit("typing", room));
  socket.on("stop typing", (room) => socket.to(room).emit("stop typing", room));

  // 4. New Message
  socket.on("new message", (newMessageReceived) => {
    var chat = newMessageReceived.chat;
    if (!chat.users) return;

    chat.users.forEach((user) => {
      if (user._id === newMessageReceived.sender._id) return;
      socket.to(user._id).emit("message received", newMessageReceived);
    });
  });

  // 5. Message Status Updates
  socket.on("message delivered", ({ messageId, chat }) => {
    chat.users.forEach((user) => {
      if (user._id === socket.userId) return;
      io.to(user._id).emit("message delivered update", messageId);
    });
  });

  socket.on("message seen", ({ messageId, chat }) => {
    chat.users.forEach((user) => {
      if (user._id === socket.userId) return;
      io.to(user._id).emit("message seen update", messageId);
    });
  });

  // ==========================================
  // ✅ CALLING LOGIC (Strictly for your feature)
  // ==========================================

  // Initiate Call
  socket.on("callUser", (data) => {
    // data: { userToCall, signalData, from, name, isVideo }
    socket.to(data.userToCall).emit("callUser", { 
        signal: data.signalData, 
        from: data.from, 
        name: data.name,
        isVideo: data.isVideo 
    });
  });

  // Answer Call
  socket.on("answerCall", (data) => {
    // data: { to, signal }
    socket.to(data.to).emit("callAccepted", data.signal);
  });

  // ==========================================
// ✅ ADDED: End Call (To inform the other user that the call has been hung up)
  socket.on("endCall", (data) => {
    // data: { id } - is the ID of the user who needs to receive the hang-up signal
    socket.to(data.id).emit("leaveCall");
  });

  // ✅ ADDED: Reject Call
socket.on("rejectCall", (data) => {
    // data: { to } - ID of the user (caller) who needs to be informed
    socket.to(data.to).emit("callRejected");
});
  // Disconnect
  socket.on("disconnect", () => {
    // Remove user from online map
    for (const [userId, socketId] of onlineUsers.entries()) {
      if (socketId === socket.id) {
        onlineUsers.delete(userId);
        // Broadcast user went offline
        io.emit("user offline", userId);
        // Send full list update just in case
        io.emit("user online", Array.from(onlineUsers.keys())); 
        break;
      }
    }
    console.log("❌ Socket disconnected:", socket.id);
  });
});