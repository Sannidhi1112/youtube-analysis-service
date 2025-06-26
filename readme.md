# YouTube Analysis Service

A comprehensive Node.js service that analyzes YouTube videos by extracting audio, generating transcriptions with word-level timestamps and speaker diarization, detecting AI-generated content, and capturing screenshots.

## Features

- 🎥 **YouTube Video Processing**: Validates and processes YouTube URLs
- 📸 **Screenshot Capture**: Uses Puppeteer to capture high-quality thumbnails
- 🎵 **Audio Extraction**: Downloads and converts audio to optimal format (16kHz, mono, 16-bit WAV)
- 📝 **Transcription**: ElevenLabs Scribe integration with word-level timestamps and speaker diarization
- 🤖 **AI Detection**: GPTZero integration for detecting AI-generated content
- 🔄 **Async Processing**: Background job processing with status tracking
- 🚀 **Production Ready**: Docker containerized with health checks and monitoring

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Web Form/API  │───▶│   Node.js App    │───▶│   Puppeteer     │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │
                                ▼
                       ┌──────────────────┐
                       │   ytdl-core +    │
                       │     FFmpeg       │
                       └──────────────────┘
                                │
                                ▼
                       ┌──────────────────┐    ┌─────────────────┐
                       │  ElevenLabs      │───▶│    GPTZero      │
                       │    Scribe        │    │  AI Detection   │
                       └──────────────────┘    └─────────────────┘
                                │
                                ▼
                       ┌──────────────────┐
                       │   JSON Results   │
                       │   + Screenshot   │
                       └──────────────────┘
```

## Setup Instructions

### Prerequisites

- Node.js 18+ 
- Docker and Docker Compose (for containerized deployment)
- ElevenLabs API key
- GPTZero API key

### Environment Variables

Create a `.env` file in the project root:

```bash
# Required API Keys
ELEVENLABS_API_KEY=your_elevenlabs_api_key_here
GPTZERO_API_KEY=your_gptzero_api_key_here

# Optional Configuration
NODE_ENV=production
PORT=8080
```

### Local Development

1. **Clone the repository**
   ```bash
   git clone https://github.com/Sannidhi1112/youtube-analysis-service.git
   cd youtube-analysis-service
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your API keys
   ```

4. **Start the development server**
   ```bash
   npm run dev
   ```

### Docker Deployment (Recommended)

1. **One-liner deployment**
   ```bash
   docker compose up -d
   ```

2. **Custom build and run**
   ```bash
   docker build -t youtube-analysis .
   docker run -p 8080:8080 --env-file .env youtube-analysis
   ```

## API Documentation

### Endpoints

#### `POST /analyze`
Submit a YouTube URL for analysis.

**Request Body:**
```json
{
  "youtube_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
}
```

**Response:**
```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "processing",
  "message": "Analysis started. Use GET /result/550e8400-e29b-41d4-a716-446655440000 to check results."
}
```

#### `GET /result/:id`
Retrieve analysis results by job ID.

**Response:**
```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2025-06-26T10:30:00.000Z",
  "youtube_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "screenshot_path": "/screenshots/550e8400-e29b-41d4-a716-446655440000.png",
  "audio_path": "/audio/550e8400-e29b-41d4-a716-446655440000.wav",
  "transcript": {
    "segments": [
      {
        "text": "Hello everyone, welcome to my channel!",
        "start": 0.0,
        "end": 2.5,
        "speaker": "SPEAKER_00",
        "words": [
          {
            "word": "We're",
            "start": 0.0,
            "end": 0.3
          },
          {
            "word": "no",
            "start": 0.3,
            "end": 0.5
          },
          {
            "word": "strangers",
            "start": 0.5,
            "end": 1.1
          },
          {
            "word": "to",
            "start": 1.1,
            "end": 1.2
          },
          {
            "word": "love",
            "start": 1.2,
            "end": 1.6
          }
        ],
        "ai_detection": {
          "ai_probability": 0.08,
          "classification": "human"
        }
      }
    ],
    "language": "en",
    "duration": 212.5
  },
  "status": "completed"
}
```

## Monitoring and Logs

### Health Checks
- **Endpoint**: `GET /health`
- **Docker**: Automatic health checks every 30 seconds
- **Response**: JSON with status and timestamp

### Logging Strategy
- **Console Logging**: Structured logs for debugging
- **File Rotation**: 10MB max size, 3 file retention
- **Error Tracking**: Comprehensive error messages with context

### Performance Monitoring
```bash
# Check service status
curl http://localhost:8080/health

# Monitor logs
docker compose logs -f youtube-analysis

# Check resource usage
docker stats youtube-analysis_youtube-analysis_1
```

## Security Considerations

1. **Rate Limiting**: Prevents abuse and API quota exhaustion
2. **Input Validation**: YouTube URL format validation
3. **Non-Root Container**: Docker runs as non-privileged user
4. **API Key Security**: Environment variable based configuration
5. **File Isolation**: Organized directory structure with proper permissions

## Troubleshooting

### Common Issues

1. **Puppeteer Issues**
   ```bash
   # Install additional dependencies
   apt-get install -y chromium-browser
   ```

2. **FFmpeg Not Found**
   ```bash
   # Ensure FFmpeg is installed
   which ffmpeg
   ```

3. **API Key Issues**
   ```bash
   # Verify environment variables
   echo $ELEVENLABS_API_KEY
   echo $GPTZERO_API_KEY
   ```

4. **Memory Issues**
   ```bash
   # Increase Docker memory limits
   docker run --memory=2g youtube-analysis
   ```

### Debug Mode
```bash
# Run with debug logging
NODE_ENV=development npm run dev
```

## Development

### Running Tests
```bash
npm test
```

### Code Quality
```bash
# Linting
npm run lint

# Format code
npm run format
```

### Contributing
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## Performance Optimization

### Resource Management
- **Memory**: 2GB limit recommended for Docker container
- **CPU**: Single core sufficient for most workloads
- **Storage**: Automatic cleanup of temporary files

### Caching Strategy
- **Audio Files**: Optionally preserved for re-analysis
- **Screenshots**: Permanently stored for reference
- **Results**: JSON cached indefinitely

## API Limits and Costs

### ElevenLabs Scribe
- **Rate Limit**: Check your plan limits
- **Cost**: Based on audio duration
- **Format**: Supports WAV, MP3, M4A

### GPTZero
- **Rate Limit**: 100 requests/minute (free tier)
- **Cost**: Per text analysis request
- **Accuracy**: 99%+ for AI detection

## Deployment Checklist

- [ ] Environment variables configured
- [ ] API keys obtained and tested
- [ ] Docker and Docker Compose installed
- [ ] Firewall rules configured
- [ ] Health checks responding
- [ ] Log monitoring set up
- [ ] Backup strategy for results

## License

MIT License - see LICENSE file for details.

## Support

For issues and questions:
1. Check the troubleshooting section
2. Review Docker logs
3. Open a GitHub issue
4. Contact support team

---

**Production URL**: `http://your-vm-ip:8080`  
**Health Check**: `http://your-vm-ip:8080/health`  
**Documentation**: This README

## Changelog

### v1.0.0
- Initial release
- YouTube URL processing
- ElevenLabs Scribe integration
- GPTZero AI detection
- Docker containerization
- GCP deployment ready
          {
            "word": "Hello",
            "start": 0.0,
            "end": 0.5
          }
        ],
        "ai_detection": {
          "ai_probability": 0.15,
          "classification": "human"
        }
      }
    ]
  },
  "status": "completed"
}
```

#### `GET /status/:id`
Check the processing status of a job.

#### `GET /health`
Health check endpoint for monitoring.

### Rate Limiting

- 10 requests per 15 minutes per IP for `/analyze` endpoint
- No rate limiting for other endpoints

## Google Cloud Platform Deployment

### VM Setup

1. **Create a GCE VM instance**
   ```bash
   gcloud compute instances create youtube-analysis-vm \
     --image-family=cos-stable \
     --image-project=cos-cloud \
     --machine-type=e2-standard-2 \
     --metadata-from-file startup-script=startup.sh \
     --tags=youtube-analysis \
     --zone=us-central1-a
   ```

2. **Firewall rule for HTTP traffic**
   ```bash
   gcloud compute firewall-rules create allow-youtube-analysis \
     --allow tcp:8080 \
     --source-ranges 0.0.0.0/0 \
     --target-tags youtube-analysis \
     --description "Allow HTTP traffic on port 8080 for YouTube Analysis Service"
   ```

3. **SSH port forwarding (fallback)**
   ```bash
   gcloud compute ssh youtube-analysis-vm \
     --zone=us-central1-a \
     --ssh-flag="-L 8080:localhost:8080"
   ```

### Startup Script (`startup.sh`)

```bash
#!/bin/bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Clone repository and start service
git clone https://github.com/yourusername/youtube-analysis-service.git
cd youtube-analysis-service

# Set environment variables
echo "ELEVENLABS_API_KEY=$ELEVENLABS_API_KEY" > .env
echo "GPTZERO_API_KEY=$GPTZERO_API_KEY" >> .env

# Start with Docker Compose
docker compose up -d
```

## Design Decisions

### Technology Choices

1. **Puppeteer**: Chosen for reliable screenshot capture and YouTube page verification
2. **ytdl-core**: Lightweight YouTube downloader with good format support
3. **FFmpeg**: Industry standard for audio processing and format conversion
4. **Express.js**: Lightweight, widely adopted web framework
5. **UUID**: For unique job identification and tracking

### Architecture Decisions

1. **Async Processing**: Jobs run in background to prevent timeout issues
2. **File Storage**: Local filesystem with organized directory structure
3. **Error Handling**: Comprehensive error catching and user-friendly responses
4. **Rate Limiting**: Prevents abuse while allowing reasonable usage
5. **Docker Containerization**: Ensures consistent deployment across environments

### API Integration Strategy

1. **ElevenLabs Scribe**: Chosen for superior accuracy and speaker diarization
2. **GPTZero**: Industry-leading AI detection with confidence scores
3. **Graceful Degradation**: Service continues even if AI detection fails

## Sample Output

### JSON Response Structure
```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2025-06-26T10:30:00.000Z",
  "youtube_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "screenshot_path": "/screenshots/550e8400-e29b-41d4-a716-446655440000.png",
  "transcript": {
    "segments": [
      {
        "text": "We're no strangers to love, you know the rules and so do I",
        "start": 0.0,
        "end": 4.2,
        "speaker": "SPEAKER_00",
        "words": [
          
