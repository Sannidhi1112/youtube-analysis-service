#!/bin/bash

# GCP VM Startup Script for YouTube Analysis Service
# This script sets up the service on a fresh Container-Optimized OS VM

set -e

# Log all output
exec > >(tee /var/log/startup-script.log)
exec 2>&1

echo "Starting YouTube Analysis Service setup..."

# Update system packages
sudo apt-get update

# Install Docker and Docker Compose
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Create application directory
mkdir -p /opt/youtube-analysis
cd /opt/youtube-analysis

# Clone the repository
git clone https://github.com/Sannidhi1112/youtube-analysis-service.git

# Create data directories with proper permissions
mkdir -p data/{uploads,results,screenshots,audio}
sudo chown -R $USER:$USER data/

# Set up environment variables from metadata or defaults
cat > .env << EOF
ELEVENLABS_API_KEY=$(curl -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/instance/attributes/elevenlabs-api-key 2>/dev/null || echo "")
GPTZERO_API_KEY=$(curl -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/instance/attributes/gptzero-api-key 2>/dev/null || echo "")
NODE_ENV=production
PORT=8080
EOF

# Create systemd service for auto-restart
sudo tee /etc/systemd/system/youtube-analysis.service > /dev/null << EOF
[Unit]
Description=YouTube Analysis Service
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/youtube-analysis
ExecStart=/usr/local/bin/docker-compose up -d
ExecStop=/usr/local/bin/docker-compose down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF

# Enable and start the service
sudo systemctl daemon-reload
sudo systemctl enable youtube-analysis.service

# Build and start the service
sudo docker-compose up -d --build

# Create a health check script
cat > /opt/youtube-analysis/health-check.sh << 'EOF'
#!/bin/bash
response=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/health)
if [ $response -eq 200 ]; then
    echo "Service is healthy"
    exit 0
else
    echo "Service is unhealthy (HTTP $response)"
    exit 1
fi
EOF

chmod +x /opt/youtube-analysis/health-check.sh

# Set up log rotation
sudo tee /etc/logrotate.d/youtube-analysis > /dev/null << EOF
/opt/youtube-analysis/data/logs/*.log {
    daily
    missingok
    rotate 7
    compress
    delaycompress
    notifempty
    create 644 $USER $USER
}
EOF

# Create monitoring script
cat > /opt/youtube-analysis/monitor.sh << 'EOF'
#!/bin/bash
# Simple monitoring script

LOG_FILE="/var/log/youtube-analysis-monitor.log"

check_service() {
    if ! /opt/youtube-analysis/health-check.sh > /dev/null 2>&1; then
        echo "$(date): Service unhealthy, restarting..." >> $LOG_FILE
        cd /opt/youtube-analysis
        sudo docker-compose restart
        sleep 30
        if /opt/youtube-analysis/health-check.sh > /dev/null 2>&1; then
            echo "$(date): Service restarted successfully" >> $LOG_FILE
        else
            echo "$(date): Service restart failed" >> $LOG_FILE
        fi
    fi
}

check_service
EOF

chmod +x /opt/youtube-analysis/monitor.sh

# Add monitoring to crontab
(crontab -l 2>/dev/null; echo "*/5 * * * * /opt/youtube-analysis/monitor.sh") | crontab -

# Install additional tools for debugging
sudo apt-get install -y curl jq htop

# Print service status
echo "Setup complete! Service status:"
sudo docker-compose ps

echo "Health check:"
sleep 10
/opt/youtube-analysis/health-check.sh || echo "Service may still be starting up..."

echo "Service URL: http://$(curl -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip):8080"

echo "Startup script completed successfully!"
exit 0
