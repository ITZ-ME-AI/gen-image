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
const mobileMenuBtn = document.getElementById('mobileMenuBtn');
const mobileMenu = document.getElementById('mobileMenu');
const closeMobileMenu = document.getElementById('closeMobileMenu');
const mobileLoginBtn = document.getElementById('mobileLoginBtn');
const mobileRegisterBtn = document.getElementById('mobileRegisterBtn');
const mobileLogoutBtn = document.getElementById('mobileLogoutBtn');

// State
let currentUser = null;
let isGenerating = false;

// Mobile Menu
mobileMenuBtn.addEventListener('click', () => {
    mobileMenu.classList.remove('hidden');
});

closeMobileMenu.addEventListener('click', () => {
    mobileMenu.classList.add('hidden');
});

// Close mobile menu when clicking a link
document.querySelectorAll('#mobileMenu a').forEach(link => {
    link.addEventListener('click', () => {
        mobileMenu.classList.add('hidden');
    });
});

// Modal Functions
function showModal(modalId) {
    document.getElementById(modalId).classList.remove('hidden');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.add('hidden');
}

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
        loginBtn.classList.add('hidden');
        registerBtn.classList.add('hidden');
        logoutBtn.classList.remove('hidden');
        userInfo.classList.remove('hidden');
        userInfo.textContent = `Welcome, ${currentUser.username}`;
        
        // Update mobile menu
        mobileLoginBtn.classList.add('hidden');
        mobileRegisterBtn.classList.add('hidden');
        mobileLogoutBtn.classList.remove('hidden');
    } else {
        loginBtn.classList.remove('hidden');
        registerBtn.classList.remove('hidden');
        logoutBtn.classList.add('hidden');
        userInfo.classList.add('hidden');
        
        // Update mobile menu
        mobileLoginBtn.classList.remove('hidden');
        mobileRegisterBtn.classList.remove('hidden');
        mobileLogoutBtn.classList.add('hidden');
    }
}

// Navigation
function showSection(sectionId) {
    // Hide all sections
    document.querySelectorAll('.section').forEach(section => {
        section.classList.add('hidden');
    });
    
    // Show selected section
    const selectedSection = document.getElementById(sectionId);
    if (selectedSection) {
        selectedSection.classList.remove('hidden');
    }
    
    // Update navigation links
    navLinks.forEach(link => {
        link.classList.remove('text-white');
        link.classList.add('text-gray-300');
        if (link.getAttribute('href') === `#${sectionId}`) {
            link.classList.remove('text-gray-300');
            link.classList.add('text-white');
        }
    });

    // Load section-specific content
    if (sectionId === 'communitySection') {
        loadCommunityImages();
    } else if (sectionId === 'generateSection') {
        if (!currentUser) {
            alert('Please login to generate images');
            showModal('loginModal');
            return;
        }
    } else if (sectionId === 'historySection') {
        if (!currentUser) {
            alert('Please login to view your history');
            showModal('loginModal');
            return;
        }
        loadUserHistory();
    }
}

// Image Generation
async function generateImage(prompt) {
    if (isGenerating) return;
    
    try {
        const token = localStorage.getItem('token');
        if (!token) {
            alert('Please login to generate images');
            showModal('loginModal');
            return;
        }

        isGenerating = true;
        generateBtn.disabled = true;
        loadingIndicator.classList.remove('hidden');
        document.getElementById('result').classList.add('hidden');
        
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
                            loadingIndicator.querySelector('span').textContent = 
                                `In queue: ${data.queueSize} people ahead, ETA: ${data.eta.toFixed(1)} seconds`;
                        } else if (data.type === 'processing') {
                            loadingIndicator.querySelector('span').textContent = 'Processing image...';
                        } else if (data.type === 'success' && data.originalUrl) {
                            // Show original URL immediately for preview in generate page
                            generatedImage.src = data.originalUrl;
                            document.getElementById('result').classList.remove('hidden');
                            loadingIndicator.querySelector('span').textContent = 'Uploading image...';
                            
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
        loadingIndicator.classList.add('hidden');
        loadingIndicator.querySelector('span').textContent = 'Creating your masterpiece...';
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
            // Sort images based on current sort order
            const sortOrder = document.getElementById('sortOrder').value;
            const sortedImages = [...images].sort((a, b) => {
                const dateA = new Date(a.created_at);
                const dateB = new Date(b.created_at);
                return sortOrder === 'old-new' ? dateA - dateB : dateB - dateA;
            });
            
            galleryContainer.innerHTML = '';
            
            sortedImages.forEach(image => {
                const card = createImageCard(image);
                galleryContainer.appendChild(card);
            });
        }
    } catch (error) {
        console.error('Failed to load community images:', error);
    }
}

// Add event listener for sort order change
document.getElementById('sortOrder').addEventListener('change', loadCommunityImages);

// Create Image Card
function createImageCard(image) {
    const card = document.createElement('div');
    card.className = 'bg-dark-surface/50 rounded-xl overflow-hidden border border-gray-800 hover:border-primary/50 transition-colors';
    card.innerHTML = `
        <div class="aspect-square overflow-hidden">
            <img src="${image.uploaded_url || image.image_url}" alt="${image.prompt}" 
                 class="w-full h-full object-cover hover:scale-105 transition-transform duration-300 cursor-pointer"
                 data-uploaded-url="${image.uploaded_url || image.image_url}"
                 data-original-url="${image.original_url || image.image_url}"
                 data-prompt="${image.prompt}">
        </div>
        <div class="p-4 space-y-2">
            <p class="text-gray-300 line-clamp-2">${image.prompt}</p>
            <div class="flex items-center justify-between text-sm">
                <p class="text-primary flex items-center">
                    <i class="fas fa-user mr-2"></i>${image.username}
                </p>
                <p class="text-gray-500 flex items-center">
                    <i class="fas fa-clock mr-2"></i>${new Date(image.created_at).toLocaleDateString()}
                </p>
            </div>
            ${currentUser && currentUser.id === image.user_id ? `
                <button onclick="deleteImage(${image.id})" 
                    class="w-full mt-2 px-4 py-2 bg-red-500/10 text-red-500 rounded-lg hover:bg-red-500/20 transition-colors">
                    <i class="fas fa-trash mr-2"></i>Delete
                </button>
            ` : ''}
        </div>
    `;

    // Add click handler for image preview
    const img = card.querySelector('img');
    img.addEventListener('click', () => {
        const previewImage = document.getElementById('previewImage');
        const previewPrompt = document.getElementById('previewPrompt');
        
        previewImage.src = img.getAttribute('data-uploaded-url');
        previewPrompt.textContent = img.getAttribute('data-prompt');
        
        showModal('imagePreviewModal');
        
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
            
            if (images.length === 0) {
                historyContainer.innerHTML = `
                    <div class="col-span-full text-center py-8">
                        <p class="text-gray-400">No images generated yet. Start creating!</p>
                    </div>
                `;
                return;
            }
            
            images.forEach(image => {
                const card = createImageCard(image);
                historyContainer.appendChild(card);
            });
        }
    } catch (error) {
        console.error('Failed to load user history:', error);
        const historyContainer = document.getElementById('historyContainer');
        if (historyContainer) {
            historyContainer.innerHTML = `
                <div class="col-span-full text-center py-8">
                    <p class="text-red-400">Failed to load history. Please try again later.</p>
                </div>
            `;
        }
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

// Mobile menu links
document.querySelectorAll('#mobileMenu a').forEach(link => {
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

// Auth Button Event Listeners
[loginBtn, mobileLoginBtn].forEach(btn => {
    if (btn) {
        btn.addEventListener('click', () => showModal('loginModal'));
    }
});

[registerBtn, mobileRegisterBtn].forEach(btn => {
    if (btn) {
        btn.addEventListener('click', () => showModal('registerModal'));
    }
});

[logoutBtn, mobileLogoutBtn].forEach(btn => {
    if (btn) {
        btn.addEventListener('click', () => {
            localStorage.removeItem('token');
            currentUser = null;
            updateAuthUI(false);
            showSection('communitySection');
            const historyContainer = document.getElementById('historyContainer');
            if(historyContainer) historyContainer.innerHTML = '';
        });
    }
});

// Form Submissions
const loginForm = document.getElementById('loginForm');
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const emailInput = document.getElementById('loginEmail');
        const passwordInput = document.getElementById('loginPassword');
        
        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    email: emailInput.value,
                    password: passwordInput.value
                })
            });
            
            if (response.ok) {
                const data = await response.json();
                localStorage.setItem('token', data.token);
                currentUser = data.user;
                updateAuthUI(true);
                closeModal('loginModal');
                emailInput.value = '';
                passwordInput.value = '';
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
        
        try {
            const response = await fetch('/api/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    username: usernameInput.value,
                    email: emailInput.value,
                    password: passwordInput.value
                })
            });
            
            if (response.ok) {
                const data = await response.json();
                localStorage.setItem('token', data.token);
                currentUser = data.user;
                updateAuthUI(true);
                closeModal('registerModal');
                usernameInput.value = '';
                emailInput.value = '';
                passwordInput.value = '';
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

// Generate Now button click handler
if (generateNowBtn) {
    generateNowBtn.addEventListener('click', () => {
        if (!currentUser) {
            alert('Please login to generate images');
            showModal('loginModal');
            return;
        }
        showSection('generateSection');
    });
} 