# YouTube Analysis Service Environment Variables

# Required API Keys
ELEVENLABS_API_KEY=your_elevenlabs_api_key_here
GPTZERO_API_KEY=your_gptzero_api_key_here

# Optional Configuration
NODE_ENV=production
PORT=8080

# Advanced Configuration (Optional)
MAX_CONCURRENT_JOBS=5
MAX_VIDEO_DURATION=3600
CLEANUP_TEMP_FILES=true
LOG_LEVEL=info

# API Rate Limits (Optional)
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=10

# File Storage Configuration (Optional)
MAX_FILE_SIZE_MB=100
STORAGE_PATH=./data