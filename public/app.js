// DOM Elements
const communitySection = document.getElementById('communitySection');
const generateSection = document.getElementById('generateSection');
const historySection = document.getElementById('historySection');
const navLinks = document.querySelectorAll('.nav-link');
const promptInput = document.getElementById('promptInput');
const generateBtn = document.getElementById('generateBtn');
const generateNowBtn = document.getElementById('generateNowBtn');
const generatedImage = document.getElementById('generatedImage');
const loadingIndicator = document.getElementById('loadingIndicator');
const suggestionChips = document.querySelectorAll('.chip');
const loginBtn = document.getElementById('loginBtn');
const registerBtn = document.getElementById('registerBtn');
const logoutBtn = document.getElementById('logoutBtn');
const userInfo = document.getElementById('userInfo');

// State
let currentUser = null;
let isGenerating = false;

// Check authentication status
async function checkAuth() {
    try {
        const token = localStorage.getItem('token');
        if (!token) {
            updateAuthUI(false);
            return;
        }

        const response = await fetch('/api/auth/status', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            currentUser = data.user;
            updateAuthUI(true);
        } else {
            localStorage.removeItem('token');
            currentUser = null;
            updateAuthUI(false);
        }
    } catch (error) {
        console.error('Auth check failed:', error);
        currentUser = null;
        updateAuthUI(false);
    }
}

// Update UI based on auth status
function updateAuthUI(isAuthenticated) {
    if (isAuthenticated) {
        loginBtn.style.display = 'none';
        registerBtn.style.display = 'none';
        logoutBtn.style.display = 'block';
        userInfo.style.display = 'block';
        userInfo.textContent = `Welcome, ${currentUser.username}`;
    } else {
        loginBtn.style.display = 'block';
        registerBtn.style.display = 'block';
        logoutBtn.style.display = 'none';
        userInfo.style.display = 'none';
    }
}

// Navigation
function showSection(sectionId) {
    // Hide all sections
    document.querySelectorAll('.section').forEach(section => {
        section.classList.remove('active');
    });
    
    // Show selected section
    const selectedSection = document.getElementById(sectionId);
    if (selectedSection) {
        selectedSection.classList.add('active');
    }
    
    // Update navigation links
    navLinks.forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('href') === `#${sectionId}`) {
            link.classList.add('active');
        }
    });

    // Load section-specific content
    if (sectionId === 'communitySection') {
        loadCommunityImages();
    } else if (sectionId === 'generateSection') {
        if (!currentUser) {
            alert('Please login to generate images');
            const loginModal = new bootstrap.Modal(document.getElementById('loginModal'));
            loginModal.show();
            return;
        }
    } else if (sectionId === 'historySection') {
        if (!currentUser) {
            alert('Please login to view your history');
            const loginModal = new bootstrap.Modal(document.getElementById('loginModal'));
            loginModal.show();
            return;
        }
        loadUserHistory();
    }

    // Close mobile menu if open
    const navbarCollapse = document.querySelector('.navbar-collapse');
    const menuOverlay = document.querySelector('.menu-overlay');
    if (navbarCollapse.classList.contains('show')) {
        navbarCollapse.classList.remove('show');
        menuOverlay.classList.remove('show');
    }
}

// Image Generation
async function generateImage(prompt) {
    if (isGenerating) return;
    
    try {
        const token = localStorage.getItem('token');
        if (!token) {
            alert('Please login to generate images');
            const loginModal = new bootstrap.Modal(document.getElementById('loginModal'));
            loginModal.show();
            return;
        }

        isGenerating = true;
        generateBtn.disabled = true;
        loadingIndicator.style.display = 'flex';
        generatedImage.style.display = 'none';
        
        // Start backend generation process
        const response = await fetch('/api/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ prompt })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to start image generation');
        }

        // Read Server-Sent Events
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        
                        if (data.type === 'estimation') {
                            loadingIndicator.querySelector('.loading-text').textContent = 
                                `In queue: ${data.queueSize} people ahead, ETA: ${data.eta.toFixed(1)} seconds`;
                        } else if (data.type === 'processing') {
                            loadingIndicator.querySelector('.loading-text').textContent = 'Processing image...';
                        } else if (data.type === 'success' && data.originalUrl) {
                            // Show original URL immediately for preview in generate page
                            generatedImage.src = data.originalUrl;
                            generatedImage.style.display = 'block';
                            loadingIndicator.querySelector('.loading-text').textContent = 'Uploading image...';
                            
                            // Upload to File2Link in the background
                            const uploadedUrl = await uploadImageToFile2Link(data.originalUrl);
                            
                            // Add image to community gallery via new backend endpoint
                            if (uploadedUrl) {
                                await addCommunityImage(data.originalUrl, uploadedUrl, prompt);
                                // Keep showing the original URL for better performance
                                loadCommunityImages();
                                loadUserHistory();
                            } else {
                                throw new Error('Image upload to File2Link failed.');
                            }
                            return;
                        } else if (data.type === 'error') {
                            throw new Error(data.message || 'Image generation failed');
                        }
                    } catch (error) {
                        console.error('Error processing SSE data:', error);
                        alert(error.message || 'An error occurred during generation.');
                        reader.cancel();
                        return;
                    }
                }
            }
        }

        throw new Error('Generation process completed without a valid response.');

    } catch (error) {
        console.error('Generation error:', error);
        alert(error.message || 'Failed to generate image. Please try again.');
    } finally {
        isGenerating = false;
        generateBtn.disabled = false;
        loadingIndicator.style.display = 'none';
        loadingIndicator.querySelector('.loading-text').textContent = 'Creating your masterpiece...';
    }
}

// Upload image to File2Link
async function uploadImageToFile2Link(imageUrl) {
    try {
        const response = await fetch(imageUrl);
        const blob = await response.blob();

        const formData = new FormData();
        formData.append('file', blob, 'generated_image.jpg');

        const uploadResponse = await fetch('https://file2link-ol4p.onrender.com/upload', {
            method: 'POST',
            body: formData
        });

        if (!uploadResponse.ok) {
            const errorData = await uploadResponse.json();
            throw new Error(errorData.error || 'File2Link upload failed');
        }

        const uploadData = await uploadResponse.json();
        return uploadData.access_url;

    } catch (error) {
        console.error('File2Link upload error:', error);
        return null;
    }
}

// Add image to community gallery
async function addCommunityImage(originalUrl, uploadedUrl, prompt) {
    try {
        const token = localStorage.getItem('token');
        if (!token) {
            console.error('Attempted to add community image without authentication.');
            return;
        }

        const response = await fetch('/api/add-community-image', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ originalUrl, uploadedUrl, prompt })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to add image to community');
        }

    } catch (error) {
        console.error('Add community image error:', error);
        alert(`Failed to add image to community: ${error.message}`);
    }
}

// Load Community Images
async function loadCommunityImages() {
    try {
        const response = await fetch('/api/community-images');
        const images = await response.json();
        
        const galleryContainer = document.getElementById('galleryContainer');
        if (galleryContainer) {
            galleryContainer.innerHTML = '';
            
            images.forEach(image => {
                const card = createImageCard(image);
                galleryContainer.appendChild(card);
            });
        }
    } catch (error) {
        console.error('Failed to load community images:', error);
    }
}

// Create Image Card
function createImageCard(image) {
    const card = document.createElement('div');
    card.className = 'col-md-4 mb-4';
    card.innerHTML = `
        <div class="community-image-card">
            <img src="${image.uploaded_url || image.image_url}" alt="${image.prompt}" class="card-img-top" 
                 data-uploaded-url="${image.uploaded_url || image.image_url}"
                 data-original-url="${image.original_url || image.image_url}"
                 data-prompt="${image.prompt}">
            <div class="card-body">
                <p class="prompt">${image.prompt}</p>
                <p class="username">
                    <i class="fas fa-user"></i>
                    ${image.username}
                </p>
                <p class="timestamp">
                    <i class="fas fa-clock"></i>
                    ${new Date(image.created_at).toLocaleDateString()}
                </p>
                ${currentUser && currentUser.id === image.user_id ? `
                    <button class="btn btn-danger btn-sm mt-2" onclick="deleteImage(${image.id})">
                        <i class="fas fa-trash"></i> Delete
                    </button>
                ` : ''}
            </div>
        </div>
    `;

    // Add click handler for image preview
    const img = card.querySelector('img');
    img.addEventListener('click', () => {
        const previewModal = new bootstrap.Modal(document.getElementById('imagePreviewModal'));
        const previewImage = document.getElementById('previewImage');
        const previewPrompt = document.getElementById('previewPrompt');
        
        // Use uploaded URL for community page preview
        const uploadedUrl = img.getAttribute('data-uploaded-url');
        previewImage.src = uploadedUrl;
        previewPrompt.textContent = img.getAttribute('data-prompt');
        
        // Show modal
        previewModal.show();
        
        // Add loading state
        previewImage.style.opacity = '0';
        previewImage.onload = () => {
            previewImage.style.opacity = '1';
        };
    });

    return card;
}

// Load User History
async function loadUserHistory() {
    if (!currentUser) return;
    
    try {
        const token = localStorage.getItem('token');
        const response = await fetch('/api/user-generations', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (!response.ok) {
            throw new Error('Failed to load history');
        }
        
        const images = await response.json();
        
        const historyContainer = document.getElementById('historyContainer');
        if (historyContainer) {
            historyContainer.innerHTML = '';
            
            images.forEach(image => {
                const card = createImageCard(image);
                historyContainer.appendChild(card);
            });
        }
    } catch (error) {
        console.error('Failed to load user history:', error);
    }
}

// Delete Image
async function deleteImage(imageId) {
    if (!confirm('Are you sure you want to delete this image? This will remove it from both your history and the community gallery.')) return;
    
    try {
        const token = localStorage.getItem('token');
        if (!token) {
            alert('You must be logged in to delete images.');
            return;
        }

        const response = await fetch(`/api/user-generations/${imageId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (response.ok) {
            // Refresh both community and history views
            await Promise.all([
                loadCommunityImages(),
                loadUserHistory()
            ]);
        } else {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to delete image');
        }
    } catch (error) {
        console.error('Delete error:', error);
        alert('Failed to delete image: ' + error.message);
    }
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    checkAuth().then(() => {
        showSection('communitySection');
    });
});

navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const sectionId = link.getAttribute('href').substring(1);
        showSection(sectionId);
    });
});

if (generateBtn) {
    generateBtn.addEventListener('click', () => {
        const prompt = promptInput.value.trim();
        if (prompt) {
            generateImage(prompt);
        } else {
            alert('Please enter a prompt.');
        }
    });
}

if (promptInput) {
    promptInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const prompt = promptInput.value.trim();
            if (prompt) {
                generateImage(prompt);
            } else {
                alert('Please enter a prompt.');
            }
        }
    });
}

suggestionChips.forEach(chip => {
    chip.addEventListener('click', () => {
        const prompt = chip.getAttribute('data-prompt');
        if (promptInput) {
            promptInput.value = prompt;
            promptInput.focus();
        }
    });
});

if (loginBtn) {
    loginBtn.addEventListener('click', () => {
        const loginModalElement = document.getElementById('loginModal');
        if (loginModalElement) {
            const loginModal = new bootstrap.Modal(loginModalElement);
            loginModal.show();
        }
    });
}

if (registerBtn) {
    registerBtn.addEventListener('click', () => {
        const registerModalElement = document.getElementById('registerModal');
        if (registerModalElement) {
            const registerModal = new bootstrap.Modal(registerModalElement);
            registerModal.show();
        }
    });
}

if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('token');
        currentUser = null;
        updateAuthUI(false);
        showSection('communitySection');
        const historyContainer = document.getElementById('historyContainer');
        if(historyContainer) historyContainer.innerHTML = '';
    });
}

// Form Submissions
const loginForm = document.getElementById('loginForm');
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const emailInput = document.getElementById('loginEmail');
        const passwordInput = document.getElementById('loginPassword');
        
        const email = emailInput ? emailInput.value : '';
        const password = passwordInput ? passwordInput.value : '';
        
        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email, password })
            });
            
            if (response.ok) {
                const data = await response.json();
                localStorage.setItem('token', data.token);
                currentUser = data.user;
                updateAuthUI(true);
                
                const loginModalElement = document.getElementById('loginModal');
                if (loginModalElement) {
                    const modal = bootstrap.Modal.getInstance(loginModalElement);
                    if (modal) modal.hide();
                }
                
                if(emailInput) emailInput.value = '';
                if(passwordInput) passwordInput.value = '';

            } else {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Login failed');
            }
        } catch (error) {
            console.error('Login error:', error);
            alert('Login failed: ' + error.message);
        }
    });
}

const registerForm = document.getElementById('registerForm');
if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const usernameInput = document.getElementById('registerUsername');
        const emailInput = document.getElementById('registerEmail');
        const passwordInput = document.getElementById('registerPassword');

        const username = usernameInput ? usernameInput.value : '';
        const email = emailInput ? emailInput.value : '';
        const password = passwordInput ? passwordInput.value : '';
        
        try {
            const response = await fetch('/api/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, email, password })
            });
            
            if (response.ok) {
                const data = await response.json();
                localStorage.setItem('token', data.token);
                currentUser = data.user;
                updateAuthUI(true);
                
                const registerModalElement = document.getElementById('registerModal');
                if (registerModalElement) {
                    const modal = bootstrap.Modal.getInstance(registerModalElement);
                    if (modal) modal.hide();
                }
                
                if(usernameInput) usernameInput.value = '';
                if(emailInput) emailInput.value = '';
                if(passwordInput) passwordInput.value = '';

            } else {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Registration failed');
            }
        } catch (error) {
            console.error('Registration error:', error);
            alert('Registration failed: ' + error.message);
        }
    });
}

// Add event listener for menu overlay
document.querySelector('.menu-overlay').addEventListener('click', () => {
    const navbarCollapse = document.querySelector('.navbar-collapse');
    const menuOverlay = document.querySelector('.menu-overlay');
    navbarCollapse.classList.remove('show');
    menuOverlay.classList.remove('show');
});

// Update navbar toggler to handle overlay
document.querySelector('.navbar-toggler').addEventListener('click', () => {
    const menuOverlay = document.querySelector('.menu-overlay');
    menuOverlay.classList.toggle('show');
});

// Generate Now button click handler
if (generateNowBtn) {
    generateNowBtn.addEventListener('click', () => {
        if (!currentUser) {
            alert('Please login to generate images');
            const loginModal = new bootstrap.Modal(document.getElementById('loginModal'));
            loginModal.show();
            return;
        }
        showSection('generateSection');
    });
} 