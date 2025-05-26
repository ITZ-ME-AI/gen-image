const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const axios = require('axios');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Database connection
const pool = new Pool({
  connectionString: 'postgresql://gen_image_ai_user:1xLfbrJINPkYCnW50Xbp6vFgard75Yjq@dpg-d0q1a5re5dus73ea07vg-a.oregon-postgres.render.com/gen_image_ai',
  ssl: {
    rejectUnauthorized: false
  }
});

// Create tables if they don't exist
const initializeDatabase = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) NOT NULL UNIQUE,
        email VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS images (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        image_url VARCHAR(255) NOT NULL,
        uploaded_url VARCHAR(255),
        prompt TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS user_generations (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        original_url VARCHAR(255) NOT NULL,
        uploaded_url VARCHAR(255),
        prompt TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP
      );
    `);
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
};

initializeDatabase();

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.sendStatus(401);

  jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// Routes
app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    
    // Check if email already exists
    const emailCheck = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (emailCheck.rows.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }
    
    // Check if username already exists
    const usernameCheck = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (usernameCheck.rows.length > 0) {
      return res.status(400).json({ error: 'Username already taken' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const result = await pool.query(
      'INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING id, username, email',
      [username, email, hashedPassword]
    );
    
    const token = jwt.sign({ id: result.rows[0].id }, process.env.JWT_SECRET || 'your-secret-key');
    res.json({ 
      token, 
      user: result.rows[0] 
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Error during registration' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);
    
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET || 'your-secret-key');
    res.json({ 
      token, 
      user: { 
        id: user.id, 
        username: user.username, 
        email: user.email 
      } 
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Error during login' });
  }
});

app.post('/api/reset-db', async (req, res) => {
  try {
    await pool.query(`
      DROP TABLE IF EXISTS user_generations;
      DROP TABLE IF EXISTS images;
      DROP TABLE IF EXISTS users;
    `);
    await initializeDatabase();
    res.json({ success: true, message: 'Database reset successfully' });
  } catch (error) {
    console.error('Error resetting database:', error);
    res.status(500).json({ error: 'Failed to reset database' });
  }
});

app.post('/api/upload-image', authenticateToken, async (req, res) => {
  try {
    const { imageUrl, prompt } = req.body;
    const userId = req.user.id;

    // First, download the image from Heartsync
    const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    const imageBuffer = Buffer.from(imageResponse.data);

    // Create form data for File2Link
    const formData = new FormData();
    formData.append('file', new Blob([imageBuffer]), 'image.jpg');

    // Upload to File2Link
    const uploadResponse = await axios.post('https://file2link-ol4p.onrender.com/upload', formData, {
      headers: {
        ...formData.getHeaders()
      }
    });

    const uploadedUrl = uploadResponse.data.access_url;

    // Save to images table for community gallery
    const imageResult = await pool.query(
      'INSERT INTO images (user_id, image_url, uploaded_url, prompt) VALUES ($1, $2, $3, $4) RETURNING *',
      [userId, imageUrl, uploadedUrl, prompt]
    );

    // Save to user_generations table for user history
    const generationResult = await pool.query(
      'INSERT INTO user_generations (user_id, original_url, uploaded_url, prompt) VALUES ($1, $2, $3, $4) RETURNING *',
      [userId, imageUrl, uploadedUrl, prompt]
    );

    res.json({ 
      success: true, 
      image: imageResult.rows[0],
      generation: generationResult.rows[0]
    });
  } catch (error) {
    console.error('Error uploading image:', error);
    res.status(500).json({ error: 'Error uploading image' });
  }
});

app.get('/api/community-images', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT i.id, i.image_url, i.uploaded_url, i.prompt, i.created_at, u.username 
      FROM images i 
      JOIN users u ON i.user_id = u.id 
      ORDER BY i.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching community images:', error);
    res.status(500).json({ error: 'Error fetching community images' });
  }
});

app.get('/api/user-generations', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await pool.query(
      'SELECT * FROM user_generations WHERE user_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC',
      [userId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching user generations:', error);
    res.status(500).json({ error: 'Error fetching user generations' });
  }
});

app.delete('/api/user-generations/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Soft delete the generation
    await pool.query(
      'UPDATE user_generations SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting generation:', error);
    res.status(500).json({ error: 'Error deleting generation' });
  }
});

// Image Generation endpoint (backend only handles Heartsync interaction)
app.post('/api/generate', authenticateToken, async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
        const { prompt } = req.body;
        const sessionHash = Math.random().toString(36).substring(2, 15);

        // First, join the queue
        const joinResponse = await axios.post('https://heartsync-nsfw-uncensored.hf.space/gradio_api/queue/join', {
            data: [
                prompt,
                "text, talk bubble, low quality, watermark, signature",
                0,
                true,
                1024,
                1024,
                7,
                28
            ],
            event_data: null,
            fn_index: 2,
            trigger_id: 14,
            session_hash: sessionHash
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Referer': 'https://heartsync-nsfw-uncensored.hf.space/'
            }
        });

        // Poll for results
        let attempts = 0;
        const maxAttempts = 60; // Increased attempts for potentially longer queues
        
        while (attempts < maxAttempts) {
            const dataResponse = await axios.get(
                `https://heartsync-nsfw-uncensored.hf.space/gradio_api/queue/data?session_hash=${encodeURIComponent(sessionHash)}`,
                {
                    headers: {
                        'Accept': 'text/event-stream',
                        'Referer': 'https://heartsync-nsfw-uncensored.hf.space/'
                    }
                }
            );

            const data = dataResponse.data;
            
            // Manually parse the event stream data
            const lines = data.split('\n');
            let eventData = '';
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    eventData += line.substring(6);
                } else if (line === '') {
                    // Process eventData when an empty line is encountered
                    if (eventData) {
                        try {
                            const json = JSON.parse(eventData);
                            
                            if (json.msg === 'process_completed' && json.output?.data?.[0]?.url) {
                                const imageUrl = json.output.data[0].url;
                                
                                // Send the original image URL back to the client as an SSE
                                res.write(`data: ${JSON.stringify({
                                    type: 'success',
                                    originalUrl: imageUrl
                                })}\n\n`);
                                res.end(); // End the connection after sending the final event
                                return; // Exit the function
                            }

                            if (json.msg === 'estimation') {
                                res.write(`data: ${JSON.stringify({ type: 'estimation', queueSize: json.queue_size, eta: json.rank_eta })}\n\n`);
                            } else if (json.msg === 'process_starts') {
                                res.write(`data: ${JSON.stringify({ type: 'processing' })}\n\n`);
                            }

                        } catch (error) {
                            console.error('Error parsing event data or processing message:', error);
                            // Continue polling even if there's a parsing error for one message
                        }
                        eventData = ''; // Reset for the next event
                    }
                } else if (line.startsWith(':')) {
                    // Ignore comment lines
                    continue;
                } else if (line !== '') {
                     // If line is not data or comment, it might be part of a multi-line data chunk, append to eventData
                     eventData += line;
                }
            }

            // If loop finishes without 'process_completed', wait and try again
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait longer before next poll attempt
            attempts++;
        }

        // If the loop times out without success
        res.status(500).write(`data: ${JSON.stringify({ type: 'error', message: 'Generation timed out' })}\n\n`);
        res.end();

    } catch (error) {
        console.error('Generation endpoint error:', error);
        res.status(500).write(`data: ${JSON.stringify({ type: 'error', message: error.message || 'Failed to generate image' })}\n\n`);
        res.end();
    }
});

// New endpoint to add community image (handles data from client-side upload)
app.post('/api/add-community-image', authenticateToken, async (req, res) => {
    try {
        const { originalUrl, uploadedUrl, prompt } = req.body;
        const userId = req.user.id;

        if (!originalUrl || !uploadedUrl || !prompt) {
             return res.status(400).json({ error: 'Missing required fields' });
        }

        // Save to images table for community gallery
        const imageResult = await pool.query(
            'INSERT INTO images (user_id, image_url, uploaded_url, prompt) VALUES ($1, $2, $3, $4) RETURNING *',
            [userId, originalUrl, uploadedUrl, prompt]
        );

        // Save to user_generations table for user history
        const generationResult = await pool.query(
            'INSERT INTO user_generations (user_id, original_url, uploaded_url, prompt) VALUES ($1, $2, $3, $4) RETURNING *',
            [userId, originalUrl, uploadedUrl, prompt]
        );

        res.json({
            success: true,
            image: imageResult.rows[0],
            generation: generationResult.rows[0]
        });
    } catch (error) {
        console.error('Error adding community image:', error);
        res.status(500).json({ error: 'Error adding image to community' });
    }
});

// Auth status endpoint
app.get('/api/auth/status', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, username, email FROM users WHERE id = $1',
            [req.user.id]
        );
        
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'User not found' });
        }
        
        res.json({ user: result.rows[0] });
    } catch (error) {
        console.error('Auth status error:', error);
        res.status(500).json({ error: 'Error checking auth status' });
    }
});

// Add pinging mechanism to keep server alive
const pingServer = async () => {
    try {
        const response = await fetch('https://gen-image-f3a3.onrender.com');
        console.log('Server pinged successfully:', response.status);
    } catch (error) {
        console.error('Error pinging server:', error);
    }
};

// Set up interval to ping every 40 seconds
setInterval(pingServer, 40000);

// Initial ping
pingServer();

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});