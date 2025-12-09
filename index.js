const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const app = express();

// 1. Better CORS Configuration
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// 2. Database Connection Cache (Vercel ke liye zaroori)
let isConnected = false;

const connectToDatabase = async () => {
    if (isConnected) {
        return;
    }
    try {
        await mongoose.connect(process.env.MONGO_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        isConnected = true;
        console.log('✅ MongoDB Connected');
    } catch (error) {
        console.error('❌ MongoDB Connection Error:', error);
    }
};

// Har request se pehle DB connect karein
app.use(async (req, res, next) => {
    await connectToDatabase();
    next();
});

// 3. User Schema (Overwrite error se bachne ke liye check lagaya hai)
const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String,
  credits: { type: Number, default: 1000 },
  plan_type: { type: String, default: 'free' },
  referral_code: { type: String, unique: true },
  referred_by: String,
  referral_count: { type: Number, default: 0 },
  is_banned: { type: Boolean, default: false }
});

const User = mongoose.models.User || mongoose.model('User', userSchema);

// 4. Routes

// Home Route (Testing ke liye)
app.get('/', (req, res) => {
    res.send('AI Multiverse Backend is Running! 🚀');
});

// Register
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    
    // Check user existence
    const existingUser = await User.findOne({ email });
    if (existingUser) {
        return res.status(400).json({ success: false, message: "Email already registered." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const refCode = 'REF-' + Math.random().toString(36).substr(2, 6).toUpperCase();
    
    const user = new User({ 
        name, 
        email, 
        password: hashedPassword, 
        referral_code: refCode 
    });
    
    await user.save();
    res.json({ success: true, message: "Account created successfully!" });
  } catch (err) { 
      console.error(err);
      res.status(500).json({ success: false, message: "Server Error" }); 
  }
});

// Login
app.post('/api/login', async (req, res) => {
  try {
      const { email, password } = req.body;
      const user = await User.findOne({ email });
      
      if (!user) return res.status(400).json({ success: false, message: "User not found" });
      if (user.is_banned) return res.status(400).json({ success: false, message: "Account banned", isBanned: true });
      
      const validPass = await bcrypt.compare(password, user.password);
      if (!validPass) return res.status(400).json({ success: false, message: "Invalid password" });
      
      const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
      
      // Remove password from response
      const userObj = user.toObject();
      delete userObj.password;

      res.json({ success: true, token, user: userObj });
  } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "Login failed" });
  }
});

// Get User Profile
app.get('/api/me', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if(!token) return res.status(401).json({message: "No token"});
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');
    if (!user) return res.status(404).json({message: "User not found"});
    res.json(user);
  } catch(e) { 
      res.status(401).json({message: "Invalid Token"}); 
  }
});

// Referral System
app.post('/api/referral/redeem', async (req, res) => {
  try {
      const { userId, code } = req.body;
      const currentUser = await User.findById(userId);
      
      if (!currentUser) return res.json({ success: false, message: "User not found" });
      if (currentUser.referred_by) return res.json({ success: false, message: "Already redeemed" });
      if (currentUser.referral_code === code) return res.json({ success: false, message: "Cannot redeem own code" });

      const referrer = await User.findOne({ referral_code: code });
      if (!referrer) return res.json({ success: false, message: "Invalid code" });

      currentUser.referred_by = referrer._id;
      currentUser.credits += 200;
      
      referrer.referral_count += 1;
      referrer.credits += 200;

      await currentUser.save();
      await referrer.save();

      res.json({ success: true, message: "Success! 200 Credits added." });
  } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "Referral failed" });
  }
});

// 5. Vercel Export (Important line)
// Local development ke liye listen karega, production mein export karega
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;
