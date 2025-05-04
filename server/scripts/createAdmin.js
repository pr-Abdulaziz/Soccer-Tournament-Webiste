const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/userSchema');
require('dotenv').config();

// Validate required environment variables
const requiredEnvVars = [
  'DATABASE',
  'DATABASE_PASSWORD',
  'JWT_SECRET'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Error: ${envVar} is not defined in .env file`);
    process.exit(1);
  }
}

// Construct MongoDB URI with password
const mongoUri = process.env.DATABASE.replace('<password>', process.env.DATABASE_PASSWORD);

// Create a model that uses the 'admin' collection
const Admin = mongoose.model('Admin', User.schema, 'admin');

const adminUser = {
  username: 'admin',
  email: 'admin@enjazi.com',
  password: 'admin123', // Will be hashed
  role: 'admin',
  admin: {
    permissions: {
      manageUsers: true,
      manageRooms: true,
      manageTasks: true,
      manageSettings: true,
      viewAnalytics: true
    },
    lastLogin: new Date(),
    loginHistory: [{
      timestamp: new Date(),
      ip: '127.0.0.1',
      device: 'Initial Setup'
    }]
  },
  settings: {
    profile: {
      avatarUrl: '',
      FName: 'Admin',
      LName: 'User',
      bio: 'System Administrator'
    },
    appearance: {
      colorTheme: 'dark',
      accentColor: 'blue',
      fontSize: 'medium',
      animation: true
    },
    pomodoro: {
      focusDuration: 25,
      shortBreak: 5,
      longBreak: 15,
      sessionBeforeLongBreak: 4,
      autoStart: true,
      autoStartNext: true,
      audio: {
        focusEndSound: 'bell.mp3',
        breakEndSound: 'ping.mp3'
      }
    },
    productivity: {
      dailyTasks: 5,
      focusHours: 4,
      pomodoroSessions: 8,
      weekStartDay: 'Mon',
      defaultTaskDuration: 15,
      taskOrder: 'due-asc'
    },
    notifications: {
      email: {
        dailyDigest: true,
        weeklySummary: true,
        taskReminder: true,
        streakUpdate: true
      },
      browser: {
        pomodoroEnd: true,
        taskDueSoon: true,
        roomUpdates: false,
        goalAchievements: false
      },
      quietHours: {
        enabled: false,
        from: '00:00',
        to: '06:00'
      }
    },
    integrations: {
      googleCalendar: false,
      slack: false,
      notion: false
    }
  },
  leaderboard: {
    points: 0,
    streak: 0,
    hours: 0,
    rank: 0
  }
};

async function createAdmin() {
  try {
    console.log('Connecting to MongoDB Atlas...');
    console.log('Database: enjazi');
    console.log('Collection: admin');

    // Connect to MongoDB Atlas
    await mongoose.connect(mongoUri);

    // Check if admin already exists
    const existingAdmin = await Admin.findOne({ 
      $or: [
        { email: adminUser.email },
        { username: adminUser.username }
      ]
    });

    if (existingAdmin) {
      console.log('Admin user already exists in the database');
      process.exit(0);
    }

    // Validate password strength
    if (adminUser.password.length < 8) {
      console.error('Error: Password must be at least 8 characters long');
      process.exit(1);
    }

    // Hash password with increased salt rounds
    const salt = await bcrypt.genSalt(12);
    adminUser.password = await bcrypt.hash(adminUser.password, salt);

    // Create admin user
    const user = new Admin(adminUser);
    await user.save();

    console.log('\nAdmin user created successfully!');
    console.log('Collection: admin');
    console.log('Username:', adminUser.username);
    console.log('Email:', adminUser.email);
    console.log('\nPlease change the password after first login');
    
    process.exit(0);
  } catch (error) {
    console.error('Error creating admin user:', error);
    process.exit(1);
  } finally {
    // Close MongoDB connection
    await mongoose.connection.close();
  }
}

createAdmin(); 