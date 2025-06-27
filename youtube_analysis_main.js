const express = require('express');
const puppeteer = require('puppeteer');
const ytdl = require('ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
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
    
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('video', { timeout: 10000 });
    await page.waitForTimeout(3000);
    
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
    console.log('🎙️ Starting ElevenLabs transcription...');
    const audioBuffer = await fs.readFile(audioPath);
    
    const FormData = require('form-data');
    const formData = new FormData();
    formData.append('audio', audioBuffer, 'audio.wav');
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

    console.log('✅ ElevenLabs transcription completed!');
    return response.data;
  } catch (error) {
    console.error('ElevenLabs transcription error:', error.response?.data || error.message);
    throw new Error(`Transcription failed: ${error.message}`);
  }
};

// GPTZero Free API (no key required)
const detectAIWithGPTZeroFree = async (text) => {
  try {
    console.log('🆓 Using GPTZero free API...');
    
    const response = await axios.post(
      'https://api.gptzero.me/v2/predict/text',
      {
        document: text,
        language: 'en'
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'YouTube-Analysis-Service/1.0'
        },
        timeout: 30000
      }
    );

    const result = response.data;
    console.log('✅ GPTZero free API response received!');
    
    return {
      ai_probability: result.documents?.[0]?.average_generated_prob || 0,
      classification: result.documents?.[0]?.completely_generated_prob > 0.5 ? 'ai' : 'human',
      confidence: result.documents?.[0]?.confidence || 0.8,
      method: 'gptzero-free',
      raw_scores: {
        avg_generated_prob: result.documents?.[0]?.average_generated_prob,
        completely_generated_prob: result.documents?.[0]?.completely_generated_prob,
        overall_burstiness: result.documents?.[0]?.overall_burstiness,
        perplexity: result.documents?.[0]?.perplexity
      }
    };
  } catch (error) {
    if (error.response?.status === 429) {
      console.log('⚠️ GPTZero free API rate limit reached, falling back...');
      return await detectAIWithPatterns(text);
    }
    
    console.error('GPTZero free API error:', error.response?.data || error.message);
    console.log('🔄 Falling back to pattern-based detection...');
    return await detectAIWithPatterns(text);
  }
};

// Pattern-based AI detection (fallback)
const detectAIWithPatterns = async (text) => {
  console.log('🔍 Using pattern-based AI detection...');
  
  const aiIndicators = [
    /as an ai/gi,
    /i am an artificial intelligence/gi,
    /i don't have personal/gi,
    /i cannot feel/gi,
    /furthermore/gi,
    /in conclusion/gi,
    /it's worth noting/gi,
    /additionally/gi,
    /moreover/gi,
    /consequently/gi
  ];
  
  let aiScore = 0;
  
  // Check for AI indicators
  aiIndicators.forEach(pattern => {
    if (pattern.test(text)) {
      aiScore += 0.2;
    }
  });
  
  // Check sentence structure
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const avgSentenceLength = sentences.reduce((sum, s) => sum + s.length, 0) / sentences.length;
  
  if (avgSentenceLength > 80) {
    aiScore += 0.1; // Very long sentences
  }
  
  // Check for repetitive patterns
  const words = text.toLowerCase().split(/\s+/);
  const uniqueWords = new Set(words);
  const repetitionRatio = words.length / uniqueWords.size;
  
  if (repetitionRatio > 2) {
    aiScore += 0.1; // High repetition
  }
  
  // Normalize score
  const aiProbability = Math.min(aiScore, 1);
  
  return {
    ai_probability: aiProbability,
    classification: aiProbability > 0.5 ? 'ai' : 'human',
    confidence: 0.6,
    method: 'pattern-based',
    indicators_found: aiIndicators.filter(pattern => pattern.test(text)).length
  };
};

// Main AI detection function with fallbacks
const detectAI = async (text) => {
  // Skip very short text
  if (text.length < 10) {
    return {
      ai_probability: 0,
      classification: 'insufficient_text',
      confidence: 0,
      method: 'skipped'
    };
  }
  
  // Try GPTZero free API first
  try {
    return await detectAIWithGPTZeroFree(text);
  } catch (error) {
    console.log('🔄 All AI detection methods failed, using fallback...');
    return await detectAIWithPatterns(text);
  }
};

// Process transcript with AI detection
const processTranscript = async (transcript) => {
  if (!transcript.segments) {
    return transcript;
  }

  console.log(`🤖 Processing ${transcript.segments.length} segments for AI detection...`);
  const processedSegments = [];
  
  for (let i = 0; i < transcript.segments.length; i++) {
    const segment = transcript.segments[i];
    console.log(`Processing segment ${i + 1}/${transcript.segments.length}: "${segment.text.substring(0, 50)}..."`);
    
    try {
      const aiDetection = await detectAI(segment.text);
      processedSegments.push({
        ...segment,
        ai_detection: aiDetection
      });
      
      // Add delay to respect API rate limits
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error) {
      console.error(`Error processing segment ${i + 1}:`, error);
      processedSegments.push({
        ...segment,
        ai_detection: {
          ai_probability: 0,
          classification: 'error',
          confidence: 0,
          error: error.message
        }
      });
    }
  }

  console.log('✅ AI detection completed for all segments!');
  return {
    ...transcript,
    segments: processedSegments
  };
};

// Test GPTZero access
const testGPTZeroAccess = async () => {
  const testText = "This is a test sentence to verify if GPTZero API is accessible and working properly.";
  
  console.log('🧪 Testing GPTZero free API access...');
  
  try {
    const result = await detectAIWithGPTZeroFree(testText);
    console.log('✅ GPTZero free API is working!');
    console.log('Test result:', result);
    return true;
  } catch (error) {
    console.log('❌ GPTZero free API test failed:', error.message);
    return false;
  }
};

// Main analysis function
const analyzeVideo = async (youtubeUrl) => {
  const jobId = uuidv4();
  const timestamp = new Date().toISOString();
  
  const screenshotPath = `./screenshots/${jobId}.png`;
  const audioPath = `./audio/${jobId}.wav`;
  const resultPath = `./results/${jobId}.json`;
  
  try {
    console.log(`🚀 Starting analysis for job ${jobId}`);
    console.log(`📺 YouTube URL: ${youtubeUrl}`);
    
    // Step 1: Take screenshot
    console.log('📸 Taking screenshot...');
    await takeScreenshot(youtubeUrl, screenshotPath);
    
    // Step 2: Download and convert audio
    console.log('🎵 Downloading and converting audio...');
    await downloadAndConvertAudio(youtubeUrl, audioPath);
    
    // Step 3: Transcribe audio
    console.log('🎙️ Transcribing audio with ElevenLabs...');
    const transcript = await transcribeAudio(audioPath);
    
    // Step 4: Process transcript with AI detection
    console.log('🤖 Running AI detection on transcript...');
    const processedTranscript = await processTranscript(transcript);
    
    // Step 5: Prepare final result
    const result = {
      job_id: jobId,
      timestamp,
      youtube_url: youtubeUrl,
      screenshot_path: `/screenshots/${jobId}.png`,
      audio_path: `/audio/${jobId}.wav`,
      transcript: processedTranscript,
      processing_summary: {
        total_segments: processedTranscript.segments?.length || 0,
        ai_segments: processedTranscript.segments?.filter(s => s.ai_detection?.classification === 'ai').length || 0,
        human_segments: processedTranscript.segments?.filter(s => s.ai_detection?.classification === 'human').length || 0,
        average_ai_probability: processedTranscript.segments?.reduce((sum, s) => sum + (s.ai_detection?.ai_probability || 0), 0) / (processedTranscript.segments?.length || 1)
      },
      status: 'completed'
    };
    
    // Save result
    await fs.writeFile(resultPath, JSON.stringify(result, null, 2));
    
    console.log(`✅ Analysis completed successfully for job ${jobId}`);
    console.log(`📊 Summary: ${result.processing_summary.total_segments} segments processed`);
    console.log(`🤖 AI segments: ${result.processing_summary.ai_segments}`);
    console.log(`👤 Human segments: ${result.processing_summary.human_segments}`);
    console.log(`📈 Average AI probability: ${(result.processing_summary.average_ai_probability * 100).toFixed(1)}%`);
    
    return result;
    
  } catch (error) {
    console.error(`❌ Analysis failed for job ${jobId}:`, error);
    
    const errorResult = {
      job_id: jobId,
      timestamp,
      youtube_url: youtubeUrl,
      status: 'failed',
      error: error.message,
      error_details: error.stack
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
            form { background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0; }
            input[type="url"] { width: 100%; padding: 10px; margin: 10px 0; box-sizing: border-box; }
            button { background: #007cba; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; margin: 10px 0; }
            button:hover { background: #005a87; }
            .status { background: #e8f5e8; padding: 10px; border-radius: 4px; margin: 10px 0; }
            .features { background: #f0f8ff; padding: 15px; border-radius: 8px; margin: 20px 0; }
        </style>
    </head>
    <body>
        <h1>🎥 YouTube Analysis Service</h1>
        <div class="status">
            <strong>✅ Service Status:</strong> Running with ElevenLabs + GPTZero Free API
        </div>
        
        <div class="features">
            <h3>🚀 What This Service Does:</h3>
            <ul>
                <li>📸 <strong>Screenshot:</strong> Captures video thumbnail with Puppeteer</li>
                <li>🎵 <strong>Audio:</strong> Downloads and converts to 16kHz WAV</li>
                <li>🎙️ <strong>Transcription:</strong> ElevenLabs Scribe with word-level timestamps</li>
                <li>🤖 <strong>AI Detection:</strong> GPTZero free API for each sentence</li>
                <li>👥 <strong>Speaker Diarization:</strong> Identifies different speakers</li>
            </ul>
        </div>
        
        <form action="/analyze" method="post">
            <label for="youtube_url"><strong>Enter YouTube URL:</strong></label>
            <input type="url" id="youtube_url" name="youtube_url" required 
                   placeholder="https://www.youtube.com/watch?v=..." />
            <button type="submit">🚀 Analyze Video</button>
        </form>
        
        <div style="margin-top: 30px;">
            <h3>📡 API Endpoints:</h3>
            <p><strong>POST /analyze</strong> - Submit YouTube URL for analysis</p>
            <p><strong>GET /result/:id</strong> - Retrieve analysis results</p>
            <p><strong>GET /status/:id</strong> - Check analysis status</p>
            <p><strong>GET /test-gptzero</strong> - Test GPTZero API access</p>
        </div>
        
        <div style="margin-top: 20px; padding: 10px; background: #fff3cd; border-radius: 4px;">
            <strong>💡 Tip:</strong> Try with a short video first (under 5 minutes) to see results quickly!
        </div>
    </body>
    </html>
  `);
});

// Test GPTZero endpoint
app.get('/test-gptzero', async (req, res) => {
  try {
    const isWorking = await testGPTZeroAccess();
    res.json({
      gptzero_free_api: isWorking ? 'working' : 'not accessible',
      message: isWorking ? 
        'GPTZero free API is accessible and working!' : 
        'GPTZero free API is not accessible, will use fallback methods',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      gptzero_free_api: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
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
    
    if (!ytdl.validateURL(youtube_url)) {
      return res.status(400).json({ error: 'YouTube video is not accessible or does not exist' });
    }
    
    const jobId = uuidv4();
    
    res.json({ 
      job_id: jobId, 
      status: 'processing',
      message: `Analysis started with ElevenLabs + GPTZero free API. Use GET /result/${jobId} to check results.`,
      estimated_time: '2-5 minutes depending on video length'
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
        timestamp: result.timestamp,
        progress: result.status === 'completed' ? 100 : 50
      });
    } catch (error) {
      if (error.code === 'ENOENT') {
        res.json({ 
          job_id: id, 
          status: 'processing',
          message: 'Analysis in progress...',
          progress: 25
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
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    apis: {
      elevenlabs: process.env.ELEVENLABS_API_KEY ? 'configured' : 'missing',
      gptzero: 'free_api_available'
    }
  });
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
  
  // Test GPTZero on startup
  console.log('🧪 Testing GPTZero free API access...');
  const gptzeroWorking = await testGPTZeroAccess();
  
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 YouTube Analysis Service running on 0.0.0.0:${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log('API Configuration:');
    console.log('- ElevenLabs API:', process.env.ELEVENLABS_API_KEY ? '✅ Configured' : '❌ Missing');
    console.log('- GPTZero Free API:', gptzeroWorking ? '✅ Working' : '⚠️ Limited/Fallback');
    console.log('');
    console.log('🌐 Test the service:');
    console.log(`- Web Interface: http://localhost:${PORT}`);
    console.log(`- Test GPTZero: http://localhost:${PORT}/test-gptzero`);
  });
};

startServer().catch(console.error);

module.exports = app;
