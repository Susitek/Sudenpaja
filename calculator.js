import * as THREE from 'three';
import { STLLoader } from 'three/addons/STLLoader.js';
import { OrbitControls } from 'three/addons/OrbitControls.js';

let scene, camera, renderer, mesh, controls;
let currentVolume = 0;
let shellVolume = 0;
let infillVolume = 0;
let directionalLight1, directionalLight2;

// Configuration
const MIN_PRICE = 5.00; // Minimum price in euros

// Material definitions
const materials = [
    { name: "PLA", density: 1.24, price: 0.125 },  // €/g
    { name: "ABS", density: 1.04, price: 0.020 }, // €/g
    { name: "PETG", density: 1.27, price: 0.125 }, // €/g
    { name: "TPU", density: 1.21, price: 0.030 }, // €/g
    { name: "Nylon-CF", density: 1.14, price: 0.50 }, // €/g
    { name: "ASA", density: 1.07, price: 0.030 } // €/g
];

try {
    document.getElementById('calculator').style.display = 'block';
    
    init();
    animate();
} catch (error) {
    console.error('Failed to initialize calculator:', error);
    // Hide calculator section on error
    document.getElementById('calculator').style.display = 'none';
}

function init() {
    const container = document.getElementById('viewer-container');
    
    if (!container) {
        throw new Error('Viewer container not found');
    }

    // 1. Setup Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a1a);

    // 2. Setup Camera
    camera = new THREE.PerspectiveCamera(
        45,
        container.clientWidth / container.clientHeight,
        0.1,
        1000
    );
    camera.position.set(50, 50, 50);

    // 3. Setup Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    // 4. Lights
    const ambientLight = new THREE.AmbientLight(0x808080);
    scene.add(ambientLight);

    // Fixed directional lights that don't rotate with camera
    directionalLight1 = new THREE.DirectionalLight(0xffffff, 2.5);
    directionalLight1.position.set(1, 1, 1);
    scene.add(directionalLight1);

    directionalLight2 = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight2.position.set(-1, -1, -1);
    scene.add(directionalLight2);

    // 5. Controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    
    // Disable zoom by default, enable with Shift key
    controls.enableZoom = false;
    
    // Track Shift key state
    let shiftPressed = false;
    
    window.addEventListener('keydown', (event) => {
        if (event.key === 'Shift') {
            shiftPressed = true;
            controls.enableZoom = true;
        }
    });
    
    window.addEventListener('keyup', (event) => {
        if (event.key === 'Shift') {
            shiftPressed = false;
            controls.enableZoom = false;
        }
    });
    
    // Prevent default wheel behavior only when zooming
    renderer.domElement.addEventListener('wheel', (event) => {
        if (shiftPressed) {
            event.preventDefault();
        }
    }, { passive: false });

    // 6. Populate material dropdown
    populateMaterialDropdown();

    // 7. Event Listeners
    window.addEventListener('resize', onWindowResize);
    document.getElementById('file-input').addEventListener('change', handleFileUpload);
    document.getElementById('material-select').addEventListener('change', () => {
        updateMaterialDetails();
        updateWeight();
        updatePrice();
    });
    document.getElementById('wall-thickness').addEventListener('input', () => {
        if (currentVolume > 0) {
            calculatePrintVolumes();
            updateWeight();
            updatePrice();
        }
    });
    document.getElementById('infill-percentage').addEventListener('input', (e) => {
        document.getElementById('infill-display').textContent = e.target.value + '%';
        if (currentVolume > 0) {
            updateWeight();
            updatePrice();
        }
    });
}

function populateMaterialDropdown() {
    const select = document.getElementById('material-select');
    select.innerHTML = ''; // Clear existing options

    materials.forEach((material, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = material.name;
        select.appendChild(option);
    });
    
    updateMaterialDetails();
}

function updateMaterialDetails() {
    const materialIndex = parseInt(document.getElementById('material-select').value);
    const material = materials[materialIndex];
    const detailsDiv = document.getElementById('material-details');
    
    detailsDiv.innerHTML = `Tiheys: ${material.density} g/cm³<br>Hinta: €${material.price}/g`;
}

function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        const contents = e.target.result;
        const loader = new STLLoader();
        const geometry = loader.parse(contents);

        // Center geometry
        geometry.computeBoundingSphere();
        const center = geometry.boundingSphere.center;
        geometry.translate(-center.x, -center.y, -center.z);

        updateMesh(geometry);
        calculateVolume(geometry);
        
        // Show the hidden controls
        document.getElementById('info').classList.add('file-loaded');
    };

    if (reader.readAsArrayBuffer) {
        reader.readAsArrayBuffer(file);
    }
}

function updateMesh(geometry) {
    if (mesh) {
        scene.remove(mesh);
        mesh.geometry.dispose();
    }

    const material = new THREE.MeshPhongMaterial({
        color: 0x0055ff,
        specular: 0x111111,
        shininess: 200
    });

    mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    // Adjust camera to fit object
    const boundingSphere = geometry.boundingSphere;
    const distance = boundingSphere.radius * 2.5;
    camera.position.set(distance, distance, distance);
    camera.lookAt(0, 0, 0);
}

// Calculate signed volume of the mesh
// Formula: Σ(p1 • (p2 x p3)) / 6
function calculateVolume(geometry) {
    let volume = 0;
    const position = geometry.attributes.position;
    const faces = position.count / 3;

    const p1 = new THREE.Vector3();
    const p2 = new THREE.Vector3();
    const p3 = new THREE.Vector3();

    // Check if geometry is indexed
    if (geometry.index) {
        const index = geometry.index;
        for (let i = 0; i < index.count; i += 3) {
            p1.fromBufferAttribute(position, index.getX(i));
            p2.fromBufferAttribute(position, index.getX(i + 1));
            p3.fromBufferAttribute(position, index.getX(i + 2));
            volume += signedVolumeOfTriangle(p1, p2, p3);
        }
    } else {
        for (let i = 0; i < position.count; i += 3) {
            p1.fromBufferAttribute(position, i);
            p2.fromBufferAttribute(position, i + 1);
            p3.fromBufferAttribute(position, i + 2);
            volume += signedVolumeOfTriangle(p1, p2, p3);
        }
    }

    currentVolume = Math.abs(volume);

    // Calculate shell and infill volumes
    calculatePrintVolumes();

    updateWeight();
    updatePrice();
}

function calculatePrintVolumes() {
    if (!mesh || currentVolume === 0) return;

    const wallThickness = parseFloat(document.getElementById('wall-thickness').value);
    
    // Get bounding box
    const bbox = new THREE.Box3().setFromObject(mesh);
    const size = new THREE.Vector3();
    bbox.getSize(size);
    
    // Estimate surface area using mesh geometry
    const geometry = mesh.geometry;
    const position = geometry.attributes.position;
    let surfaceArea = 0;
    
    const p1 = new THREE.Vector3();
    const p2 = new THREE.Vector3();
    const p3 = new THREE.Vector3();
    const edge1 = new THREE.Vector3();
    const edge2 = new THREE.Vector3();
    const cross = new THREE.Vector3();
    
    if (geometry.index) {
        const index = geometry.index;
        for (let i = 0; i < index.count; i += 3) {
            p1.fromBufferAttribute(position, index.getX(i));
            p2.fromBufferAttribute(position, index.getX(i + 1));
            p3.fromBufferAttribute(position, index.getX(i + 2));
            
            edge1.subVectors(p2, p1);
            edge2.subVectors(p3, p1);
            cross.crossVectors(edge1, edge2);
            surfaceArea += cross.length() * 0.5;
        }
    } else {
        for (let i = 0; i < position.count; i += 3) {
            p1.fromBufferAttribute(position, i);
            p2.fromBufferAttribute(position, i + 1);
            p3.fromBufferAttribute(position, i + 2);
            
            edge1.subVectors(p2, p1);
            edge2.subVectors(p3, p1);
            cross.crossVectors(edge1, edge2);
            surfaceArea += cross.length() * 0.5;
        }
    }
    
    // Estimate shell volume: surface area * wall thickness
    // This is a simplified approximation
    shellVolume = surfaceArea * wallThickness;
    
    // Ensure shell volume doesn't exceed total volume
    if (shellVolume > currentVolume) {
        shellVolume = currentVolume;
        infillVolume = 0;
    } else {
        infillVolume = currentVolume - shellVolume;
    }
}

function updateWeight() {
    if (currentVolume === 0) {
        document.getElementById('weight-display').innerText = 'Paino: - g';
        return;
    }

    const materialIndex = parseInt(document.getElementById('material-select').value);
    const material = materials[materialIndex];
    const infillPercent = parseFloat(document.getElementById('infill-percentage').value) / 100;
    
    // Calculate effective volume in cm³
    const shellVolumeCm3 = shellVolume / 1000; // Shell is 100% solid
    const infillVolumeCm3 = (infillVolume / 1000) * infillPercent; // Infill is partial
    const effectiveVolumeCm3 = shellVolumeCm3 + infillVolumeCm3;
    
    const shellWeight = shellVolumeCm3 * material.density;
    const infillWeight = infillVolumeCm3 * material.density;
    const totalWeight = shellWeight + infillWeight;

    document.getElementById('weight-display').innerHTML =
        `Paino: ${totalWeight.toFixed(2)} g<br>- Seinämä: ${shellWeight.toFixed(2)} g<br>- Täyttö: ${infillWeight.toFixed(2)} g`;
}

function updatePrice() {
    if (currentVolume === 0) {
        document.getElementById('price-display').innerText = 'Hinta: €0.00';
        document.getElementById('min-price-message').textContent = '';
        return;
    }

    const materialIndex = parseInt(document.getElementById('material-select').value);
    const material = materials[materialIndex];
    const infillPercent = parseFloat(document.getElementById('infill-percentage').value) / 100;
    
    // Calculate effective volume in cm³
    const shellVolumeCm3 = shellVolume / 1000;
    const infillVolumeCm3 = (infillVolume / 1000) * infillPercent;
    const effectiveVolumeCm3 = shellVolumeCm3 + infillVolumeCm3;
    
    // Calculate weight in grams
    const weight = effectiveVolumeCm3 * material.density;
    
    // Calculate price based on weight
    let totalPrice = weight * material.price;
    
    // Apply minimum price
    const messageDiv = document.getElementById('min-price-message');
    if (totalPrice < MIN_PRICE) {
        messageDiv.textContent = `Vähimmäishinta €${MIN_PRICE.toFixed(2)} sovellettu`;
        totalPrice = MIN_PRICE;
    } else {
        messageDiv.textContent = '';
    }

    document.getElementById('price-display').innerText =
        `Hinta: €${totalPrice.toFixed(2)}`;
}

function signedVolumeOfTriangle(p1, p2, p3) {
    return p1.dot(p2.cross(p3)) / 6.0;
}

function onWindowResize() {
    const container = document.getElementById('viewer-container');
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    
    // Keep lights in fixed positions (don't rotate with camera)
    if (directionalLight1 && directionalLight2) {
        directionalLight1.position.set(1, 1, 1).normalize();
        directionalLight2.position.set(-1, -1, -1).normalize();
    }
    
    renderer.render(scene, camera);
}
