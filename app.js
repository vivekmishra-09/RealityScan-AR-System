const State = new Proxy({
    view: 'scanner', isScanning: false, activeID: null,
    renderMode: 'mesh', db: null
}, {
    set(target, key, value) {
        target[key] = value;
        if (key === 'view') Vision.syncView(value);
        if (key === 'activeID') document.getElementById('obj-id').innerText = value;
        return true;
    }
});

const Archive = {
    async init() {
        return new Promise(res => {
            const req = indexedDB.open('REALITY_OS_DB', 8);
            req.onupgradeneeded = e => e.target.result.createObjectStore('spatial', { keyPath: 'id' });
            req.onsuccess = e => { State.db = e.target.result; res(); };
        });
    },
    async save(p) { return State.db.transaction('spatial', 'readwrite').objectStore('spatial').put(p); },
    async get(id) {
        return new Promise(res => {
            const req = State.db.transaction('spatial', 'readonly').objectStore('spatial').get(id);
            req.onsuccess = () => res(req.result);
        });
    }
};

const Renderer = {
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 1000),
    webgl: new THREE.WebGLRenderer({ antialias: true, alpha: true }),
    mesh: null, points: null,

    setup() {
        this.webgl.setSize(window.innerWidth, window.innerHeight);
        this.webgl.setPixelRatio(window.devicePixelRatio);
        document.getElementById('canvas-3d').appendChild(this.webgl.domElement);
        this.controls = new THREE.OrbitControls(this.camera, this.webgl.domElement);
        this.controls.enableDamping = true;
        this.camera.position.z = 5;
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.4), new THREE.PointLight(0x00f3ff, 1.2, 50));
        this.loop();
    },

    async reconstruct(color, depth) {
        // GPU Memory Cleanup
        [this.mesh, this.points].forEach(o => {
            if(o) {
                this.scene.remove(o);
                o.geometry.dispose();
                o.material.dispose();
            }
        });

        const loader = new THREE.TextureLoader();
        const [cTex, dTex] = await Promise.all([loader.loadAsync(color), loader.loadAsync(depth)]);
        const geo = new THREE.PlaneGeometry(4, 4, 128, 128);

        this.mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
            map: cTex, displacementMap: dTex, displacementScale: 1.5, metalness: 0.5, roughness: 0.4
        }));
        this.points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.015, map: cTex }));
        
        this.sync();
    },

    sync() {
        this.scene.remove(this.mesh, this.points);
        this.scene.add(State.renderMode === 'mesh' ? this.mesh : this.points);
    },

    loop() { requestAnimationFrame(() => this.loop()); this.controls.update(); this.webgl.render(this.scene, this.camera); }
};

const Vision = {
    feed: document.getElementById('v-feed'),
    async start() {
        this.feed.srcObject = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    },
    async snap() {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1024;
        const ctx = canvas.getContext('2d');
        const s = Math.min(this.feed.videoWidth, this.feed.videoHeight);
        ctx.drawImage(this.feed, (this.feed.videoWidth-s)/2, 0, s, s, 0, 0, 1024, 1024);
        const color = canvas.toDataURL('image/webp', 0.8);
        
        const img = ctx.getImageData(0,0,1024,1024);
        for(let i=0; i<img.data.length; i+=4) {
            const g = (img.data[i]*0.3 + img.data[i+1]*0.59 + img.data[i+2]*0.11);
            img.data[i] = img.data[i+1] = img.data[i+2] = g;
        }
        ctx.putImageData(img, 0, 0);
        return { color, depth: canvas.toDataURL('image/webp', 0.5) };
    },
    syncView(v) { document.querySelectorAll('.view').forEach(e => e.classList.toggle('active', e.id === `view-${v}`)); }
};

// --- SYSTEM LOGIC ---
window.onload = async () => {
    await Archive.init(); await Vision.start(); Renderer.setup();

    // 1. Capture Logic
    document.getElementById('btn-capture').onclick = async () => {
        const data = await Vision.snap();
        const sid = Math.random().toString(36).substr(2, 6).toUpperCase();
        await Archive.save({ id: sid, ...data });
        State.activeID = 'RS_' + sid;
        await Renderer.reconstruct(data.color, data.depth);
        State.view = 'render';
    };

    // 2. File Upload Logic (Device Select)
    document.getElementById('btn-upload').onclick = () => document.getElementById('file-input').click();
    document.getElementById('file-input').onchange = async (e) => {
        const file = e.target.files[0];
        if(!file) return;
        const reader = new FileReader();
        reader.onload = async (ev) => {
            // Hum upload ki gayi image ko hi color aur depth dono maan rahe hain (Auto-reconstruct)
            await Renderer.reconstruct(ev.target.result, ev.target.result);
            State.activeID = 'IMPORT_' + Math.random().toString(36).substr(2, 4).toUpperCase();
            State.view = 'render';
        };
        reader.readAsDataURL(file);
    };

    // 3. QR & Download Logic
    document.getElementById('gen-anchor').onclick = () => {
        const out = document.getElementById('qr-output');
        out.innerHTML = "";
        new QRCode(out, { text: State.activeID, width: 200, height: 200 });
        document.getElementById('modal-anchor').classList.remove('hidden');
    };

    document.getElementById('btn-download-qr').onclick = () => {
        const img = document.querySelector('#qr-output img');
        const link = document.createElement('a');
        link.download = `${State.activeID}_ANCHOR.png`;
        link.href = img.src;
        link.click();
    };

    // UI Toggles
    document.getElementById('toggle-lidar').onclick = () => { State.renderMode = State.renderMode === 'mesh' ? 'points' : 'mesh'; Renderer.sync(); };
    document.getElementById('btn-exit').onclick = () => State.view = 'scanner';
    document.getElementById('close-modal').onclick = () => document.getElementById('modal-anchor').classList.add('hidden');
    document.getElementById('btn-qr-mode').onclick = () => { State.isScanning = true; /* QR Scan loop here */ };
};
