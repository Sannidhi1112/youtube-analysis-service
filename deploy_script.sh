#!/bin/bash

# YouTube Analysis Service - GCP Deployment Script
# This script automates the deployment of the service to Google Cloud Platform

set -e

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_ID=""
ZONE="us-central1-a"
MACHINE_TYPE="e2-standard-2"
INSTANCE_NAME="youtube-analysis-vm"
SERVICE_TAG="youtube-analysis"
FIREWALL_RULE="allow-youtube-analysis"

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_step() {
    echo -e "${BLUE}[STEP]${NC} $1"
}

# Function to check if gcloud is installed and authenticated
check_gcloud() {
    if ! command -v gcloud &> /dev/null; then
        print_error "gcloud CLI is not installed. Please install it first."
        exit 1
    fi

    if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | head -n1 &> /dev/null; then
        print_error "Not authenticated with gcloud. Please run 'gcloud auth login' first."
        exit 1
    fi

    print_status "gcloud CLI is installed and authenticated"
}

# Function to set project ID
set_project() {
    if [ -z "$PROJECT_ID" ]; then
        print_step "Enter your Google Cloud Project ID:"
        read -r PROJECT_ID
    fi

    if [ -z "$PROJECT_ID" ]; then
        print_error "Project ID is required"
        exit 1
    fi

    gcloud config set project "$PROJECT_ID"
    print_status "Project set to: $PROJECT_ID"
}

# Function to get API keys
get_api_keys() {
    print_step "Enter your ElevenLabs API Key:"
    read -rs ELEVENLABS_API_KEY
    echo

    print_step "Enter your GPTZero API Key:"
    read -rs GPTZERO_API_KEY
    echo

    if [ -z "$ELEVENLABS_API_KEY" ] || [ -z "$GPTZERO_API_KEY" ]; then
        print_error "Both API keys are required"
        exit 1
    fi

    print_status "API keys configured"
}

# Function to enable required APIs
enable_apis() {
    print_step "Enabling required Google Cloud APIs..."
    
    gcloud services enable compute.googleapis.com
    gcloud services enable logging.googleapis.com
    gcloud services enable monitoring.googleapis.com
    
    print_status "APIs enabled successfully"
}

# Function to create firewall rule
create_firewall_rule() {
    print_step "Creating firewall rule..."
    
    if gcloud compute firewall-rules describe "$FIREWALL_RULE" &> /dev/null; then
        print_warning "Firewall rule '$FIREWALL_RULE' already exists"
    else
        gcloud compute firewall-rules create "$FIREWALL_RULE" \
            --allow tcp:8080 \
            --source-ranges 0.0.0.0/0 \
            --target-tags "$SERVICE_TAG" \
            --description "Allow HTTP traffic on port 8080 for YouTube Analysis Service"
        
        print_status "Firewall rule created successfully"
    fi
}

# Function to create startup script
create_startup_script() {
    print_step "Creating startup script..."
    
    cat > startup-script.sh << EOF
#!/bin/bash
set -e

# Log all output
exec > >(tee /var/log/startup-script.log)
exec 2>&1

echo "Starting YouTube Analysis Service setup..."

# Update and install Docker
apt-get update
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Install Docker Compose
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-\$(uname -s)-\$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# Create application directory
mkdir -p /opt/youtube-analysis
cd /opt/youtube-analysis

# Clone repository
git clone https://github.com/yourusername/youtube-analysis-service.git .

# Create data directories
mkdir -p data/{uploads,results,screenshots,audio}

# Set up environment variables
cat > .env << EOL
ELEVENLABS_API_KEY=$ELEVENLABS_API_KEY
GPTZERO_API_KEY=$GPTZERO_API_KEY
NODE_ENV=production
PORT=8080
EOL

# Build and start the service
docker-compose up -d --build

# Create systemd service
cat > /etc/systemd/system/youtube-analysis.service << EOL
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
EOL

systemctl daemon-reload
systemctl enable youtube-analysis.service

echo "Setup completed successfully!"
EOF

    print_status "Startup script created"
}

# Function to create VM instance
create_vm_instance() {
    print_step "Creating VM instance..."
    
    if gcloud compute instances describe "$INSTANCE_NAME" --zone="$ZONE" &> /dev/null; then
        print_warning "VM instance '$INSTANCE_NAME' already exists"
        print_step "Do you want to delete and recreate it? (y/N)"
        read -r response
        if [[ "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
            gcloud compute instances delete "$INSTANCE_NAME" --zone="$ZONE" --quiet
        else
            print_status "Using existing instance"
            return
        fi
    fi
    
    gcloud compute instances create "$INSTANCE_NAME" \
        --zone="$ZONE" \
        --machine-type="$MACHINE_TYPE" \
        --network-tier=PREMIUM \
        --maintenance-policy=MIGRATE \
        --service-account="$PROJECT_ID-compute@developer.gserviceaccount.com" \
        --scopes=https://www.googleapis.com/auth/cloud-platform \
        --tags="$SERVICE_TAG" \
        --image-family=ubuntu-2004-lts \
        --image-project=ubuntu-os-cloud \
        --boot-disk-size=20GB \
        --boot-disk-type=pd-standard \
        --boot-disk-device-name="$INSTANCE_NAME" \
        --metadata-from-file startup-script=startup-script.sh \
        --metadata="elevenlabs-api-key=$ELEVENLABS_API_KEY,gptzero-api-key=$GPTZERO_API_KEY"
    
    print_status "VM instance created successfully"
}

# Function to wait for service to be ready
wait_for_service() {
    print_step "Waiting for service to be ready..."
    
    EXTERNAL_IP=$(gcloud compute instances describe "$INSTANCE_NAME" \
        --zone="$ZONE" \
        --format='get(networkInterfaces[0].accessConfigs[0].natIP)')
    
    SERVICE_URL="http://$EXTERNAL_IP:8080"
    
    print_status "Service URL: $SERVICE_URL"
    print_status "Waiting for service to start (this may take a few minutes)..."
    
    max_attempts=30
    attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        if curl -f -s "$SERVICE_URL/health" > /dev/null 2>&1; then
            print_status "Service is ready!"
            break
        fi
        
        echo -n "."
        sleep 10
        ((attempt++))
    done
    
    if [ $attempt -gt $max_attempts ]; then
        print_warning "Service did not become ready within expected time"
        print_status "You can check the logs with:"
        echo "gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --command='sudo docker-compose -f /opt/youtube-analysis/docker-compose.yml logs'"
    fi
}

# Function to display deployment information
show_deployment_info() {
    EXTERNAL_IP=$(gcloud compute instances describe "$INSTANCE_NAME" \
        --zone="$ZONE" \
        --format='get(networkInterfaces[0].accessConfigs[0].natIP)')
    
    echo
    echo "======================================"
    print_status "DEPLOYMENT COMPLETED SUCCESSFULLY!"
    echo "======================================"
    echo
    print_status "Service Information:"
    echo "  • Service URL: http://$EXTERNAL_IP:8080"
    echo "  • Health Check: http://$EXTERNAL_IP:8080/health"
    echo "  • Instance Name: $INSTANCE_NAME"
    echo "  • Zone: $ZONE"
    echo "  • External IP: $EXTERNAL_IP"
    echo
    print_status "Useful Commands:"
    echo "  • SSH to instance:"
    echo "    gcloud compute ssh $INSTANCE_NAME --zone=$ZONE"
    echo
    echo "  • SSH with port forwarding (fallback):"
    echo "    gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --ssh-flag='-L 8080:localhost:8080'"
    echo
    echo "  • View service logs:"
    echo "    gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --command='sudo docker-compose -f /opt/youtube-analysis/docker-compose.yml logs'"
    echo
    echo "  • Restart service:"
    echo "    gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --command='sudo systemctl restart youtube-analysis'"
    echo
    echo "  • Delete instance (cleanup):"
    echo "    gcloud compute instances delete $INSTANCE_NAME --zone=$ZONE"
    echo
    print_status "Test the service:"
    echo "  curl -X POST http://$EXTERNAL_IP:8080/analyze \\"
    echo "    -H 'Content-Type: application/json' \\"
    echo "    -d '{\"youtube_url\": \"https://www.youtube.com/watch?v=dQw4w9WgXcQ\"}'"
    echo
}

# Function to test deployment
test_deployment() {
    print_step "Do you want to run a test deployment? (y/N)"
    read -r response
    
    if [[ "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
        EXTERNAL_IP=$(gcloud compute instances describe "$INSTANCE_NAME" \
            --zone="$ZONE" \
            --format='get(networkInterfaces[0].accessConfigs[0].natIP)')
        
        print_step "Testing health endpoint..."
        if curl -f -s "http://$EXTERNAL_IP:8080/health" | jq . > /dev/null 2>&1; then
            print_status "Health check passed!"
        else
            print_warning "Health check failed - service may still be starting"
        fi
        
        print_step "Testing analyze endpoint with sample URL..."
        RESPONSE=$(curl -s -X POST "http://$EXTERNAL_IP:8080/analyze" \
            -H 'Content-Type: application/json' \
            -d '{"youtube_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}')
        
        if echo "$RESPONSE" | jq -e '.job_id' > /dev/null 2>&1; then
            JOB_ID=$(echo "$RESPONSE" | jq -r '.job_id')
            print_status "Analysis started successfully! Job ID: $JOB_ID"
            print_status "Check status with: curl http://$EXTERNAL_IP:8080/status/$JOB_ID"
        else
            print_warning "Analysis test failed. Response: $RESPONSE"
        fi
    fi
}

# Function to cleanup on failure
cleanup_on_failure() {
    print_error "Deployment failed. Cleaning up..."
    
    if gcloud compute instances describe "$INSTANCE_NAME" --zone="$ZONE" &> /dev/null; then
        print_step "Delete the failed instance? (y/N)"
        read -r response
        if [[ "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
            gcloud compute instances delete "$INSTANCE_NAME" --zone="$ZONE" --quiet
            print_status "Instance deleted"
        fi
    fi
}

# Main deployment function
main() {
    echo "======================================"
    echo "YouTube Analysis Service - GCP Deploy"
    echo "======================================"
    echo
    
    # Set up error handling
    trap cleanup_on_failure ERR
    
    # Pre-deployment checks
    check_gcloud
    set_project
    get_api_keys
    
    # Deployment steps
    enable_apis
    create_firewall_rule
    create_startup_script
    create_vm_instance
    wait_for_service
    
    # Post-deployment
    show_deployment_info
    test_deployment
    
    # Cleanup
    rm -f startup-script.sh
    
    print_status "Deployment script completed!"
}

# Script entry point
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi