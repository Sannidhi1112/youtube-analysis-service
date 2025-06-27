# YouTube Analysis Service Environment Variables

# Create/update your .env file
cat > .env << 'EOF'
ELEVENLABS_API_KEY=sk_66cb33663690d92af17b5b09ca2ce9686b4323a9640f6ffa
NODE_ENV=development
PORT=8080
EOF

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
