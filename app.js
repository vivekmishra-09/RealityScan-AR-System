/**
 * REALITYSCAN_OS // CORE KERNEL v7.0_ADVANCED
 * FEATURE-SET: REACTIVE STATE, VOLUMETRIC SHADERS, ARCHIVE PERSISTENCE
 */

// 1. REACTIVE STATE ENGINE (Proxy-based)
const State = new Proxy({
    view: 'scanner',
    isScanning: false,
    activeID: null,
    renderMode: 'mesh', // 'mesh' | 'points'
    metrics: { dim: '0x0x0', vol: '0.00' },
    db: null
}, {
    set(target, key, value) {
        target[key] = value;
        // Global UI Sync
        if (key === 'view') Vision.syncView(value);
        if (key === 'metrics') UI.updateMetrics(value);
        if (key === 'activeID') UI.updateID(value);
        return true;
    }
});

// 2. SPATIAL STORAGE (IndexedDB)
const Archive = {
    async init() {
        return new Promise((res) => {
            const req = indexedDB.open('REALITY_DATABASE', 7);
            req.onupgradeneeded = e => e.target.result.createObjectStore('spatial_data', { keyPath: 'id' });
            req.onsuccess = e => { State.db = e.target.result; res(); };
        });
    },
    async save(payload) {
        const tx = State.db.transaction('spatial_data', 'readwrite');
        return tx.objectStore('spatial_data').put(payload);
    },
    async get(id) {
        return new Promise(res => {
            const tx = State.db.transaction('spatial_data', 'readonly');
            const req = tx.objectStore('spatial_data').get(id);
            req.onsuccess = () => res(req.result);
        });
    }
};

// 3. THE VOLUMETRIC RENDERER (Three.js Advanced)
const Renderer = {
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 1000),
    webgl: new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" }),
    mesh: null, points: null,

    setup() {
        this.webgl.setSize(window.innerWidth, window.innerHeight);
        this.webgl.setPixelRatio(window.devicePixelRatio);
        document.getElementById('canvas-3d').appendChild(this.webgl.domElement);
        
        this.controls = new THREE.OrbitControls(this.camera, this.webgl.domElement);
        this.controls.enableDamping = true; // Premium feel
        this.camera.position.set(0, 0, 4);

        const sun = new THREE.DirectionalLight(0x00f3ff, 1.5);
        sun.position.set(2, 5, 5);
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.3), sun);
        this.loop();
    },

    async reconstruct(colorBlob, depthBlob) {
        // Clear previous buffers
        [this.mesh, this.points].forEach(o => o && this.scene.remove(o));

        const loader = new THREE.TextureLoader();
        const [cTex, dTex] = await Promise.all([
            loader.loadAsync(colorBlob),
            loader.loadAsync(depthBlob)
        ]);

        const geometry = new THREE.PlaneGeometry(4, 4, 256, 256); // High-density grid

        // ADVANCED PBR MATERIAL
        const material = new THREE.MeshStandardMaterial({
            map: cTex,
            displacementMap: dTex,
            displacementScale: 1.6,
            displacementBias: -0.2,
            roughness: 0.4,
            metalness: 0.7,
            envMapIntensity: 1
        });

        this.mesh = new THREE.Mesh(geometry, material);
        this.points = new THREE.Points(geometry, new THREE.PointsMaterial({ 
            size: 0.012, map: cTex, transparent: true, opacity: 0.8 
        }));

        this.syncMode();
        this.computeSpatialPhysics();
    },

    syncMode() {
        this.scene.remove(this.mesh, this.points);
        this.scene.add(State.renderMode === 'mesh' ? this.mesh : this.points);
    },

    computeSpatialPhysics() {
        this.mesh.geometry.computeBoundingBox();
        const box = new THREE.Box3().setFromObject(this.mesh);
        const size = new THREE.Vector3();
        box.getSize(size);
        
        State.metrics = {
            dim: `${(size.x*10).toFixed(1)}x${(size.y*10).toFixed(1)}x${(size.z*10).toFixed(1)}`,
            vol: (size.x * size.y * size.z).toFixed(2)
        };
    },

    loop() {
        requestAnimationFrame(() => this.loop());
        this.controls.update();
        this.webgl.render(this.scene, this.camera);
    }
};

// 4. VISION & SIGNAL PROCESSING
const Vision = {
    feed: document.getElementById('v-feed'),
    qrCtx: document.getElementById('qr-canvas').getContext('2d'),

    async stream() {
        const config = { video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } };
        this.feed.srcObject = await navigator.mediaDevices.getUserMedia(config);
    },

    async capture() {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1024;
        const ctx = canvas.getContext('2d');
        
        // Square center-crop logic
        const dim = Math.min(this.feed.videoWidth, this.feed.videoHeight);
        ctx.drawImage(this.feed, (this.feed.videoWidth-dim)/2, 0, dim, dim, 0, 0, 1024, 1024);
        const rawColor = canvas.toDataURL('image/webp', 0.9);

        // Signal isolation for depth estimation
        const frame = ctx.getImageData(0,0,1024,1024);
        for(let i=0; i<frame.data.length; i+=4) {
            const gray = (frame.data[i]*0.3 + frame.data[i+1]*0.59 + frame.data[i+2]*0.11);
            frame.data[i] = frame.data[i+1] = frame.data[i+2] = gray;
        }
        ctx.putImageData(frame, 0, 0);
        return { color: rawColor, depth: canvas.toDataURL('image/webp', 0.6) };
    },

    scanLoop() {
        if (!State.isScanning) return;
        const { canvas } = this.qrCtx;
        canvas.width = this.feed.videoWidth; canvas.height = this.feed.videoHeight;
        this.qrCtx.drawImage(this.feed, 0, 0);
        
        const signal = jsQR(this.qrCtx.getImageData(0,0,canvas.width,canvas.height).data, canvas.width, canvas.height);
        if (signal && signal.data.startsWith('RS_')) {
            this.handleDeepLink(signal.data.replace('RS_', ''));
            State.isScanning = false;
            return;
        }
        requestAnimationFrame(() => this.scanLoop());
    },

    async handleDeepLink(id) {
        const data = await Archive.get(id);
        if (data) {
            State.activeID = 'RS_' + id;
            await Renderer.reconstruct(data.color, data.depth);
            State.view = 'render';
        }
    },

    syncView(v) {
        document.querySelectorAll('.view').forEach(el => el.classList.toggle('active', el.id === `view-${v}`));
    }
};

// 5. UI INTERFACE CONTROLLER
const UI = {
    updateMetrics: m => document.getElementById('obj-metrics').innerText = `DIM: ${m.dim} CM | VOL: ${m.vol}L`,
    updateID: id => document.getElementById('obj-id').innerText = id,
    generateAnchor(id) {
        const target = document.getElementById('qr-output');
        target.innerHTML = '';
        new QRCode(target, { text: id, width: 200, height: 200, colorDark: "#000000", colorLight: "#ffffff" });
        document.getElementById('modal-anchor').classList.remove('hidden');
    }
};

// 6. SYSTEM BOOT
(async () => {
    await Archive.init();
    await Vision.stream();
    Renderer.setup();

    // Event Delegator
    document.body.addEventListener('click', async (e) => {
        const id = e.target.id;
        
        if (id === 'btn-capture') {
            const data = await Vision.capture();
            const sid = Math.random().toString(36).substr(2, 6).toUpperCase();
            await Archive.save({ id: sid, ...data });
            State.activeID = 'RS_' + sid;
            await Renderer.reconstruct(data.color, data.depth);
            State.view = 'render';
        }

        if (id === 'btn-qr-mode') {
            State.isScanning = true;
            Vision.scanLoop();
        }

        if (id === 'toggle-lidar') {
            State.renderMode = State.renderMode === 'mesh' ? 'points' : 'mesh';
            Renderer.syncMode();
        }

        if (id === 'gen-anchor') UI.generateAnchor(State.activeID);
        if (id === 'close-modal') document.getElementById('modal-anchor').classList.add('hidden');
        if (id === 'btn-exit') State.view = 'scanner';
    });
})();
