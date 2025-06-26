const express = require('express');
const puppeteer = require('puppeteer');
const ytdl = require('ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10 // limit each IP to 10 requests per windowMs
});
app.use('/analyze', limiter);

// Ensure directories exist
const ensureDirectories = async () => {
  const dirs = ['./uploads', './results', './screenshots', './audio'];
  for (const dir of dirs) {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      console.error(`Failed to create directory ${dir}:`, error);
    }
  }
};

// YouTube URL validation
const validateYouTubeUrl = (url) => {
  const patterns = [
    /^https?:\/\/(www\.)?youtube\.com\/watch\?v=[\w-]+/,
    /^https?:\/\/youtu\.be\/[\w-]+/,
    /^https?:\/\/(www\.)?youtube\.com\/embed\/[\w-]+/
  ];
  return patterns.some(pattern => pattern.test(url));
};

// Screenshot with Puppeteer
const takeScreenshot = async (url, screenshotPath) => {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    
    // Navigate to YouTube URL
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Wait for video player and try to verify playback capability
    await page.waitForSelector('video', { timeout: 10000 });
    
    // Wait a bit more for the page to fully load
    await page.waitForTimeout(3000);
    
    // Take screenshot
    await page.screenshot({ 
      path: screenshotPath, 
      fullPage: false,
      quality: 90
    });

    console.log(`Screenshot saved: ${screenshotPath}`);
    return true;
  } catch (error) {
    console.error('Screenshot error:', error);
    throw new Error(`Failed to take screenshot: ${error.message}`);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
};

// Download and convert audio
const downloadAndConvertAudio = async (url, outputPath) => {
  return new Promise((resolve, reject) => {
    try {
      const stream = ytdl(url, { 
        quality: 'highestaudio',
        filter: 'audioonly'
      });

      ffmpeg(stream)
        .audioFrequency(16000)
        .audioChannels(1)
        .audioBitrate(16)
        .format('wav')
        .on('error', (err) => {
          console.error('FFmpeg error:', err);
          reject(new Error(`Audio conversion failed: ${err.message}`));
        })
        .on('end', () => {
          console.log(`Audio converted: ${outputPath}`);
          resolve();
        })
        .save(outputPath);
    } catch (error) {
      reject(new Error(`Audio download failed: ${error.message}`));
    }
  });
};

// ElevenLabs Scribe transcription
const transcribeAudio = async (audioPath) => {
  try {
    const audioBuffer = await fs.readFile(audioPath);
    
    const formData = new FormData();
    formData.append('audio', new Blob([audioBuffer], { type: 'audio/wav' }), 'audio.wav');
    formData.append('model', 'eleven_multilingual_v2');
    formData.append('language', 'en');
    formData.append('timestamp_granularities[]', 'word');
    formData.append('timestamp_granularities[]', 'segment');

    const response = await axios.post(
      'https://api.elevenlabs.io/v1/speech-to-text',
      formData,
      {
        headers: {
          'xi-api-key': process.env.ELEVENLABS_API_KEY,
          ...formData.getHeaders()
        }
      }
    );

    return response.data;
  } catch (error) {
    console.error('Transcription error:', error.response?.data || error.message);
    throw new Error(`Transcription failed: ${error.message}`);
  }
};

// GPTZero AI detection
const detectAI = async (text) => {
  try {
    const response = await axios.post(
      'https://api.gptzero.me/v2/predict/text',
      {
        document: text
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.GPTZERO_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return {
      ai_probability: response.data.documents[0]?.average_generated_prob || 0,
      classification: response.data.documents[0]?.class || 'unknown'
    };
  } catch (error) {
    console.error('GPTZero error:', error.response?.data || error.message);
    return {
      ai_probability: 0,
      classification: 'error',
      error: error.message
    };
  }
};

// Process transcript with AI detection
const processTranscript = async (transcript) => {
  if (!transcript.segments) {
    return transcript;
  }

  const processedSegments = [];
  
  for (const segment of transcript.segments) {
    const aiDetection = await detectAI(segment.text);
    
    processedSegments.push({
      ...segment,
      ai_detection: aiDetection
    });
    
    // Add delay to respect API rate limits
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return {
    ...transcript,
    segments: processedSegments
  };
};

// Main analysis function
const analyzeVideo = async (youtubeUrl) => {
  const jobId = uuidv4();
  const timestamp = new Date().toISOString();
  
  const screenshotPath = `./screenshots/${jobId}.png`;
  const audioPath = `./audio/${jobId}.wav`;
  const resultPath = `./results/${jobId}.json`;
  
  try {
    console.log(`Starting analysis for job ${jobId}`);
    
    // Step 1: Take screenshot
    console.log('Taking screenshot...');
    await takeScreenshot(youtubeUrl, screenshotPath);
    
    // Step 2: Download and convert audio
    console.log('Downloading and converting audio...');
    await downloadAndConvertAudio(youtubeUrl, audioPath);
    
    // Step 3: Transcribe audio
    console.log('Transcribing audio...');
    const transcript = await transcribeAudio(audioPath);
    
    // Step 4: Process transcript with AI detection
    console.log('Running AI detection...');
    const processedTranscript = await processTranscript(transcript);
    
    // Step 5: Prepare final result
    const result = {
      job_id: jobId,
      timestamp,
      youtube_url: youtubeUrl,
      screenshot_path: `/screenshots/${jobId}.png`,
      audio_path: `/audio/${jobId}.wav`,
      transcript: processedTranscript,
      status: 'completed'
    };
    
    // Save result
    await fs.writeFile(resultPath, JSON.stringify(result, null, 2));
    
    // Clean up audio file to save space (optional)
    // await fs.unlink(audioPath);
    
    console.log(`Analysis completed for job ${jobId}`);
    return result;
    
  } catch (error) {
    console.error(`Analysis failed for job ${jobId}:`, error);
    
    const errorResult = {
      job_id: jobId,
      timestamp,
      youtube_url: youtubeUrl,
      status: 'failed',
      error: error.message
    };
    
    await fs.writeFile(resultPath, JSON.stringify(errorResult, null, 2));
    throw error;
  }
};

// Routes
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>YouTube Analysis Service</title>
        <style>
            body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
            form { background: #f5f5f5; padding: 20px; border-radius: 8px; }
            input[type="url"] { width: 100%; padding: 10px; margin: 10px 0; box-sizing: border-box; }
            button { background: #007cba; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; }
            button:hover { background: #005a87; }
            .example { margin-top: 20px; font-size: 0.9em; color: #666; }
        </style>
    </head>
    <body>
        <h1>YouTube Analysis Service</h1>
        <p>Submit a YouTube URL for comprehensive analysis including transcription, AI detection, and screenshots.</p>
        
        <form action="/analyze" method="post">
            <label for="youtube_url">YouTube URL:</label>
            <input type="url" id="youtube_url" name="youtube_url" required 
                   placeholder="https://www.youtube.com/watch?v=..." />
            <button type="submit">Analyze Video</button>
        </form>
        
        <div class="example">
            <h3>API Usage:</h3>
            <p><strong>POST /analyze</strong> - Submit YouTube URL for analysis</p>
            <p><strong>GET /result/:id</strong> - Retrieve analysis results</p>
            <p><strong>GET /status/:id</strong> - Check analysis status</p>
        </div>
    </body>
    </html>
  `);
});

app.post('/analyze', async (req, res) => {
  try {
    const { youtube_url } = req.body;
    
    if (!youtube_url) {
      return res.status(400).json({ error: 'YouTube URL is required' });
    }
    
    if (!validateYouTubeUrl(youtube_url)) {
      return res.status(400).json({ error: 'Invalid YouTube URL format' });
    }
    
    // Check if video is accessible
    if (!ytdl.validateURL(youtube_url)) {
      return res.status(400).json({ error: 'YouTube video is not accessible or does not exist' });
    }
    
    // Start analysis (async)
    const jobId = uuidv4();
    
    // Return job ID immediately
    res.json({ 
      job_id: jobId, 
      status: 'processing',
      message: 'Analysis started. Use GET /result/' + jobId + ' to check results.'
    });
    
    // Process in background
    analyzeVideo(youtube_url).catch(error => {
      console.error(`Background analysis failed for job ${jobId}:`, error);
    });
    
  } catch (error) {
    console.error('Analysis request error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/result/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const resultPath = `./results/${id}.json`;
    
    try {
      const resultData = await fs.readFile(resultPath, 'utf8');
      const result = JSON.parse(resultData);
      res.json(result);
    } catch (error) {
      if (error.code === 'ENOENT') {
        res.status(404).json({ error: 'Result not found' });
      } else {
        throw error;
      }
    }
  } catch (error) {
    console.error('Result retrieval error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/status/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const resultPath = `./results/${id}.json`;
    
    try {
      const resultData = await fs.readFile(resultPath, 'utf8');
      const result = JSON.parse(resultData);
      res.json({ 
        job_id: id, 
        status: result.status,
        timestamp: result.timestamp 
      });
    } catch (error) {
      if (error.code === 'ENOENT') {
        res.json({ 
          job_id: id, 
          status: 'processing',
          message: 'Analysis in progress...' 
        });
      } else {
        throw error;
      }
    }
  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Serve static files
app.use('/screenshots', express.static('screenshots'));
app.use('/audio', express.static('audio'));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
const startServer = async () => {
  await ensureDirectories();
  
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`YouTube Analysis Service running on 0.0.0.0:${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log('Required environment variables:');
    console.log('- ELEVENLABS_API_KEY:', process.env.ELEVENLABS_API_KEY ? '✓ Set' : '✗ Missing');
    console.log('- GPTZERO_API_KEY:', process.env.GPTZERO_API_KEY ? '✓ Set' : '✗ Missing');
  });
};

startServer().catch(console.error);

module.exports = app;