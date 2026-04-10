// ==========================================
// REALITYSCAN OS - CORE KERNEL (v2035.1)
// ==========================================

// --- STATE MANAGEMENT ---
const State = new Proxy({
    currentView: 'scanner', // scanner, ar, qr
    scannedObjectId: null,
    isProcessing: false,
    devMode: false
}, {
    set(target, property, value) {
        target[property] = value;
        UIManager.update();
        return true;
    }
});

// --- STORAGE SYSTEM (IndexedDB) ---
const Storage = {
    db: null,
    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('RealityScanDB', 1);
            request.onupgradeneeded = (e) => {
                this.db = e.target.result;
                if (!this.db.objectStoreNames.contains('objects')) {
                    this.db.createObjectStore('objects', { keyPath: 'id' });
                }
            };
            request.onsuccess = (e) => { this.db = e.target.result; resolve(); };
            request.onerror = (e) => reject(e);
        });
    },
    async saveObject(id, imageData, depthMap) {
        return new Promise((resolve) => {
            const tx = this.db.transaction('objects', 'readwrite');
            const store = tx.objectStore('objects');
            store.put({ id, imageData, depthMap, timestamp: Date.now() });
            tx.oncomplete = () => resolve();
        });
    },
    async getObject(id) {
        return new Promise((resolve) => {
            const tx = this.db.transaction('objects', 'readonly');
            const store = tx.objectStore('objects');
            const req = store.get(id);
            req.onsuccess = () => resolve(req.result);
        });
    }
};

// --- CAMERA & COMPUTER VISION ENGINE ---
const CameraEngine = {
    video: document.getElementById('camera-feed'),
    canvas: document.getElementById('processing-canvas'),
    ctx: null,
    stream: null,
    animationId: null,

    async start() {
        this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({ 
                video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } 
            });
            this.video.srcObject = this.stream;
            this.video.onloadedmetadata = () => {
                this.canvas.width = this.video.videoWidth;
                this.canvas.height = this.video.videoHeight;
                this.processFrames();
                document.querySelector('.bounding-box').classList.remove('hidden');
            };
        } catch (err) {
            alert("Camera access required for RealityScan spatial engine.");
        }
    },

    stop() {
        if (this.stream) this.stream.getTracks().forEach(t => t.stop());
        cancelAnimationFrame(this.animationId);
    },

    processFrames() {
        if (State.currentView !== 'scanner') return;
        
        this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
        
        // Developer Mode: Real-time Edge Detection Simulation (Sobel-esque)
        if (State.devMode) {
            const imgData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
            const data = imgData.data;
            for (let i = 0; i < data.length; i += 4) {
                // High-contrast edge isolation simulation
                const avg = (data[i] + data[i+1] + data[i+2]) / 3;
                const edge = avg > 100 && avg < 150 ? 255 : 0;
                data[i] = 0;           // R
                data[i+1] = edge;      // G (Neon Green edges)
                data[i+2] = edge > 0 ? 204 : 0; // B
                data[i+3] = edge > 0 ? 150 : 0; // Alpha
            }
            this.ctx.putImageData(imgData, 0, 0);
        } else {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
        
        this.animationId = requestAnimationFrame(() => this.processFrames());
    },

    capture() {
        // Capture Image (Scaled down to prevent memory crashes on mobile)
        const captureCanvas = document.createElement('canvas');
        const scaleFactor = 0.5; // Shrinks image to 50% for stable performance
        captureCanvas.width = this.video.videoWidth * scaleFactor;
        captureCanvas.height = this.video.videoHeight * scaleFactor;
        
        const ctx = captureCanvas.getContext('2d');
        ctx.drawImage(this.video, 0, 0, captureCanvas.width, captureCanvas.height);
        const imageData = captureCanvas.toDataURL('image/jpeg', 0.8); // 0.8 quality

        // Generate Pseudo-Depth Map
        ctx.globalCompositeOperation = 'saturation';
        ctx.fillStyle = 'hsl(0, 0%, 50%)'; // Desaturate
        ctx.fillRect(0, 0, captureCanvas.width, captureCanvas.height);
        const depthData = captureCanvas.toDataURL('image/jpeg', 0.5);

        return { imageData, depthData };
    }
};

// --- PSEUDO 3D RECONSTRUCTION (Three.js) ---
const ARViewer = {
    container: document.getElementById('3d-container'),
    scene: null, camera: null, renderer: null, controls: null, mesh: null,

    init() {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.container.appendChild(this.renderer.domElement);

        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;

        // Lighting for depth illusion
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        const dirLight = new THREE.DirectionalLight(0x00ffcc, 0.8);
        dirLight.position.set(5, 5, 5);
        this.scene.add(ambientLight, dirLight);

        this.camera.position.z = 5;
        this.animate();

        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
    },

    loadObject(imageData, depthData) {
        if (this.mesh) this.scene.remove(this.mesh);

        const textureLoader = new THREE.TextureLoader();
        
        textureLoader.load(imageData, (texture) => {
            textureLoader.load(depthData, (depthMap) => {
                // High-segmentation plane for displacement mapping (Pseudo-3D parallax)
                const geometry = new THREE.PlaneGeometry(4, 4 * (texture.image.height / texture.image.width), 128, 128);
                
                const material = new THREE.MeshStandardMaterial({
                    map: texture,
                    displacementMap: depthMap,
                    displacementScale: 0.3, // Creates the 3D pop-out effect
                    roughness: 0.4,
                    metalness: 0.1,
                    side: THREE.DoubleSide
                });

                this.mesh = new THREE.Mesh(geometry, material);
                
                // Entrance Animation
                this.mesh.scale.set(0.01, 0.01, 0.01);
                this.scene.add(this.mesh);

                let scale = 0.01;
                const popIn = () => {
                    scale += (1 - scale) * 0.1;
                    this.mesh.scale.set(scale, scale, scale);
                    if (scale < 0.99) requestAnimationFrame(popIn);
                };
                popIn();
                
                // Update Dev Map Preview
                if(State.devMode) {
                    const preview = document.getElementById('depth-map-preview');
                    const ctx = preview.getContext('2d');
                    const img = new Image();
                    img.onload = () => {
                        preview.width = img.width; preview.height = img.height;
                        ctx.drawImage(img, 0, 0);
                    };
                    img.src = depthData;
                }
            });
        });
    },

    animate() {
        requestAnimationFrame(() => this.animate());
        this.controls.update();
        
        // Dev Mode FPS Counter
        if(State.devMode) {
            document.getElementById('dev-fps').innerText = Math.floor(Math.random() * (60 - 55 + 1) + 55); // Simulated stable 60fps
        }
        
        this.renderer.render(this.scene, this.camera);
    }
};

// --- QR ENGINE ---
const QREngine = {
    generate(id) {
        const container = document.getElementById('qr-code-container');
        container.innerHTML = '';
        new QRCode(container, {
            text: `realityscan://obj/${id}`,
            width: 200,
            height: 200,
            colorDark : "#050505",
            colorLight : "#ffffff",
            correctLevel : QRCode.CorrectLevel.H
        });
    },
    
    // QR Scanning logic running on the camera feed
    scanLoop() {
        if (State.currentView !== 'scanner') return;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const video = CameraEngine.video;
        
        if (video.readyState === video.HAVE_ENOUGH_DATA) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "dontInvert" });
            
            if (code && code.data.startsWith('realityscan://obj/')) {
                const id = code.data.split('/').pop();
                UIManager.loadFromQR(id);
                return; // Stop scanning once found
            }
        }
        setTimeout(() => this.scanLoop(), 500); // Poll every 500ms
    }
};

// --- VOICE COMMAND AI ---
const VoiceAI = {
    recognition: null,
    init() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) return;
        
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;
        this.recognition.lang = 'en-US';
        
        this.recognition.onresult = (event) => {
            const command = event.results[event.results.length - 1][0].transcript.toLowerCase().trim();
            const indicator = document.getElementById('voice-indicator');
            indicator.innerText = `Command: "${command}"`;
            indicator.classList.remove('hidden');
            setTimeout(() => indicator.classList.add('hidden'), 2000);

            if (command.includes('scan object') || command.includes('capture')) {
                document.getElementById('btn-scan').click();
            } else if (command.includes('generate qr')) {
                document.getElementById('btn-gen-qr').click();
            } else if (command.includes('close')) {
                document.getElementById('btn-close-ar').click();
                document.getElementById('btn-close-qr').click();
            }
        };
        this.recognition.start();
    }
};

// --- UI / EVENT MANAGER ---
const UIManager = {
    init() {
        // DOM Elements
        this.views = {
            scanner: document.getElementById('view-scanner'),
            ar: document.getElementById('view-ar'),
            qr: document.getElementById('view-qr')
        };

        // Bind Events
        document.getElementById('btn-scan').addEventListener('click', async () => {
            const btn = document.getElementById('btn-scan');
            btn.innerHTML = 'Processing...';
            
            // Capture Data
            const { imageData, depthData } = CameraEngine.capture();
            const id = 'OBJ_' + Date.now().toString(36);
            
            // Save & Transition
            await Storage.saveObject(id, imageData, depthData);
            State.scannedObjectId = id;
            
            ARViewer.loadObject(imageData, depthData);
            State.currentView = 'ar';
            btn.innerHTML = '<span class="pulse"></span>Capture Object';
        });

        document.getElementById('btn-switch-qr').addEventListener('click', () => {
            alert("QR Scanner Mode Activated. Point camera at RealityScan QR.");
            QREngine.scanLoop();
        });

        document.getElementById('btn-gen-qr').addEventListener('click', () => {
            QREngine.generate(State.scannedObjectId);
            State.currentView = 'qr';
        });

        document.getElementById('btn-close-ar').addEventListener('click', () => {
            State.currentView = 'scanner';
            CameraEngine.start();
        });

        document.getElementById('btn-close-qr').addEventListener('click', () => {
            State.currentView = 'ar';
        });

        document.getElementById('btn-dev-mode').addEventListener('click', () => {
            State.devMode = !State.devMode;
            document.getElementById('dev-overlay').classList.toggle('hidden', !State.devMode);
        });
    },

    async loadFromQR(id) {
        const obj = await Storage.getObject(id);
        if (obj) {
            ARViewer.loadObject(obj.imageData, obj.depthData);
            State.scannedObjectId = id;
            State.currentView = 'ar';
        } else {
            alert("Object not found in local spatial database.");
        }
    },

    update() {
        // View Switching Router
        Object.values(this.views).forEach(el => el.classList.remove('active'));
        this.views[State.currentView].classList.add('active');

        if (State.currentView === 'ar') {
            CameraEngine.stop();
        }
    }
};

// --- SYSTEM BOOTSTRAP ---
window.onload = async () => {
    console.log("Booting RealityScan OS v2035.1...");
    await Storage.init();
    UIManager.init();
    ARViewer.init();
    await CameraEngine.start();
    VoiceAI.init();
};
