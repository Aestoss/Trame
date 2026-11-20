# Deploying trame to a Google Cloud Always Free VM

Why a VM instead of Cloud Run: see the "Firebase/GCP service mapping" and
"Hard problem 1" sections of the migration scope doc. Short version --
Cloud Run has no real persistent local disk, and its two network-storage
options (GCS FUSE, Filestore) are either unreliable for SQLite or not free.
A small Always-Free `e2-micro` VM gives trame a real local disk, exactly
like the Railway container it's replacing, at a standing $0/month within
Google's Always Free limits:

- 1 non-preemptible `e2-micro` instance/month, in `us-west1` (Oregon),
  `us-central1` (Iowa), or `us-east1` (South Carolina) only.
- 30 GB-months of standard persistent disk.
- 1 GB/month of outbound data transfer from North America (the one figure
  worth watching if image generation gets heavy use -- see the cost section
  of the scope doc).

These commands are meant to be run by you (from your own machine, with
`gcloud` authenticated to your GCP account), not by an automated agent --
this writes to a real GCP project and nothing here was run on your behalf.

## 1. One-time VM setup

```bash
# Pick a project and region from the Always Free list above.
export PROJECT_ID=your-gcp-project-id
export ZONE=us-west1-b   # any zone in us-west1/us-central1/us-east1

gcloud config set project "$PROJECT_ID"

# The VM: e2-micro, Debian 12, 30GB standard disk (the free allowance).
gcloud compute instances create trame-vm \
  --zone="$ZONE" \
  --machine-type=e2-micro \
  --image-family=debian-12 \
  --image-project=debian-cloud \
  --boot-disk-size=30GB \
  --boot-disk-type=pd-standard \
  --tags=trame-http

# Allow inbound HTTP on port 80 (the container listens on 8080 internally;
# this maps 80 -> 8080 on the host). Add 443 later if you put TLS in front
# of it (e.g. a Caddy/Certbot reverse proxy) -- out of scope for this step.
gcloud compute firewall-rules create allow-trame-http \
  --allow=tcp:80 \
  --target-tags=trame-http \
  --direction=INGRESS
```

## 2. Install Docker and deploy the app (run once, via SSH)

```bash
gcloud compute ssh trame-vm --zone="$ZONE"
```

Then, on the VM itself:

```bash
# Docker Engine (Debian's official convenience script).
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
# log out and back in (or `newgrp docker`) for the group change to apply

# Clone the repo and build the image.
git clone https://github.com/Aestoss/trame.git
cd trame
git checkout main   # or whichever branch you want live
docker build -t trame .

# Persistent data lives on the boot disk itself -- it's already the 30GB
# free allowance, so a second disk isn't needed for a single-user app.
sudo mkdir -p /opt/trame-data

# Run it. --restart unless-stopped means it survives a VM reboot with no
# extra systemd unit needed.
docker run -d --name trame-app \
  --restart unless-stopped \
  -p 80:8080 \
  -v /opt/trame-data:/data \
  trame
```

Find the VM's public IP with `gcloud compute instances describe trame-vm
--zone=$ZONE --format='get(networkInterfaces[0].accessConfigs[0].natIP)'`
and open `http://<that IP>/` -- trame should be live.

## 3. Redeploying after a code change

Save this as `~/redeploy.sh` on the VM (or run it by hand):

```bash
#!/bin/bash
set -e
cd ~/trame
git pull
docker build -t trame .
docker stop trame-app || true
docker rm trame-app || true
docker run -d --name trame-app \
  --restart unless-stopped \
  -p 80:8080 \
  -v /opt/trame-data:/data \
  trame
```

There's no push-to-deploy the way Cloud Run or Railway offer -- this is the
real ongoing cost of the Always Free VM path (see the scope doc's
functionality-impact section). `chmod +x ~/redeploy.sh` once, then
`./redeploy.sh` after each pull.

## 4. Moving data from Railway (phase 2 of the migration plan)

Not covered here -- this file is phase 1 (dark launch alongside Railway,
with a fresh/test database). Copying the real production `trame.db` and
`images/` directory over is part of phase 2 once this VM is confirmed
working end to end; see the scope doc's phased migration plan section.
