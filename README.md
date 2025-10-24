# skintel backend core

complete backend setup for skintel — express api + fastapi facial landmarks microservice, all wired up and docker-ready fr.

## what’s inside

* **express backend** (port 3000): main api for onboarding, auth, and user stuff
* **fastapi landmarks** (port 8000): facial landmark detection service
* **postgresql database**: handles all persistence things

## quick start (docker way)

### prereqs

* docker + docker compose
* at least 8gb ram (dlib is kinda hungry, as it seems)

### spin it up

```bash
# clone and enter the repo
git clone <repository>
cd skintel-backend-core

# start all services
chmod +x scripts/run-services.sh
./scripts/run-services.sh
```

this will:

1. build both services in one container
2. download the dlib facial landmarks model
3. start the postgres db
4. run express api on port 3000
5. run fastapi on port 8000

### access points

* **main api** → [http://localhost:3000](http://localhost:3000)
* **api docs** → [http://localhost:3000/docs](http://localhost:3000/docs)
* **landmarks api** → [http://localhost:8000](http://localhost:8000)
* **landmarks docs** → [http://localhost:8000/docs](http://localhost:8000/docs)
* **health checks**

  * [http://localhost:3000/health](http://localhost:3000/health)
  * [http://localhost:8000/health](http://localhost:8000/health)

### dev commands

```bash
# view logs live
docker-compose logs -f

# stop everything
docker-compose down

# rebuild and restart (fresh start vibes)
docker-compose up --build

# database migrations
docker-compose exec skintel-services sh -c "cd /app/backend && npm run db:push"
```

## manual setup (no docker)

if you’re more of a hands-on type:

### 1. express backend

```bash
cd skintel-backend
npm install
cp .env.example .env
# update .env with your database url
npm run db:generate
npm run db:push
npm run dev
```

### 2. fastapi landmarks

```bash
cd skintel-facial-landmarks
pip install -r requirements.txt
python download_model.py
uvicorn main:app --reload
```

### 3. postgresql

```bash
# install postgres and create db
createdb skintel_db
```

## api testing

```bash
# test the full flow
cd skintel-backend
npm test

# or check health manually
curl http://localhost:3000/health
curl http://localhost:8000/health
```

## Deployment steps:

tar --exclude-vcs --exclude='*.tar.gz' -czf skintel-backend-core-$(date +%Y%m%d%H%M%S).tar.gz .
scp -i ~/Downloads/skintel-mumbai.pem skintel-backend-core-20251022204205.tar.gz admin@13.233.238.57:/home/admin
ssh admin@13.233.238.57 -i ~/Downloads/skintel-mumbai.pem
mv skintel-backend-core-*.tar.gz skintel
tar -xvf skintel-backend-core-*tar.gz
rm skintel-backend-core-*tar.gz
sudo docker compose down
sudo docker compose up -d --build

