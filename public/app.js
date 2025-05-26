// DOM Elements
const homeSection = document.getElementById('homeSection');
const communitySection = document.getElementById('communitySection');
const historySection = document.getElementById('historySection');
const navLinks = document.querySelectorAll('.nav-link');
const promptInput = document.getElementById('promptInput');
const generateBtn = document.getElementById('generateBtn');
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
    [homeSection, communitySection, historySection].forEach(section => {
        section.style.display = 'none';
    });
    
    document.getElementById(sectionId).style.display = 'block';
    
    navLinks.forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('href') === `#${sectionId}`) {
            link.classList.add('active');
        }
    });

    if (sectionId === 'communitySection') {
        loadCommunityImages();
    } else if (sectionId === 'historySection' && currentUser) {
        loadUserHistory();
    }
}

// Image Generation
async function generateImage(prompt) {
    if (isGenerating) return;
    
    try {
        isGenerating = true;
        generateBtn.disabled = true;
        loadingIndicator.style.display = 'flex';
        generatedImage.style.display = 'none';
        
        const token = localStorage.getItem('token');
        if (!token) {
            throw new Error('Please login to generate images');
        }

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
                            loadingIndicator.innerHTML = `In queue: ${data.queueSize} people ahead, ETA: ${data.eta.toFixed(1)} seconds`;
                        } else if (data.type === 'processing') {
                            loadingIndicator.innerHTML = 'Processing image...';
                        } else if (data.type === 'success' && data.originalUrl) {
                            // Received original URL from backend, now upload to File2Link
                            loadingIndicator.innerHTML = 'Uploading image...';
                            const uploadedUrl = await uploadImageToFile2Link(data.originalUrl);
                            
                            // Add image to community gallery via new backend endpoint
                            if (uploadedUrl) {
                                await addCommunityImage(data.originalUrl, uploadedUrl, prompt);
                                generatedImage.src = uploadedUrl;
                                generatedImage.style.display = 'block';
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
                         // Stop reading the stream on error
                         reader.cancel();
                         return;
                    }
                }
            }
        }

        // If the stream closes without a success or error message
        throw new Error('Generation process completed without a valid response.');

    } catch (error) {
        console.error('Generation error:', error);
        alert(error.message || 'Failed to generate image. Please try again.');
    } finally {
        isGenerating = false;
        generateBtn.disabled = false;
        loadingIndicator.style.display = 'none';
        loadingIndicator.innerHTML = 'Creating your masterpiece...';
    }
}

// Upload image to File2Link
async function uploadImageToFile2Link(imageUrl) {
    try {
        // Fetch the image data
        const response = await fetch(imageUrl);
        const blob = await response.blob();

        // Create form data
        const formData = new FormData();
        formData.append('file', blob, 'generated_image.jpg'); // Use a generic filename

        // Upload to File2Link API
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
        // Do NOT show an alert here, handle error in generateImage's catch block
        return null;
    }
}

// Add image to community gallery via backend endpoint
async function addCommunityImage(originalUrl, uploadedUrl, prompt) {
     try {
         const token = localStorage.getItem('token');
         if (!token) {
             // This case should ideally not happen if generateImage checks auth first
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

         // Success, nothing more to do here, loadCommunityImages and loadUserHistory are called in generateImage

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
    card.className = 'col-md-4'; // Use Bootstrap grid class
    card.innerHTML = `
        <div class="community-image-card">
            <img src="${image.uploaded_url || image.image_url}" alt="${image.prompt}" class="card-img-top">
            <div class="card-body">
                <p class="prompt">${image.prompt}</p>
                <p class="username">By ${image.username}</p>
                <p class="timestamp">${new Date(image.created_at).toLocaleDateString()}</p>
                ${currentUser && currentUser.id === image.user_id ? `
                    <button class="btn btn-danger btn-sm mt-2" onclick="deleteImage(${image.id})">
                        <i class="fas fa-trash"></i> Delete
                    </button>
                ` : ''}
            </div>
        </div>
    `;
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
    if (!confirm('Are you sure you want to delete this image?')) return;
    
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
            // Refresh both galleries after deletion
            loadCommunityImages();
            loadUserHistory();
        } else {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to delete image');
        }
    } catch (error) {
        console.error('Delete error:', error);
        alert('Failed to delete image: ' + error.message);
    }
}

// Reset Database (Admin Functionality)
async function resetDatabase() {
    if (!currentUser || currentUser.username !== 'admin') {
        alert('You do not have permission to reset the database.');
        return;
    }

    if (!confirm('Are you sure you want to reset the database? This will delete ALL users, images, and generations. This action cannot be undone.')) return;
    
    try {
        const response = await fetch('/api/reset-db', {
            method: 'POST',
            headers: {
                 'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        if (response.ok) {
            alert('Database reset successfully');
            // Clear UI and reload initial state
            loadCommunityImages();
            if (currentUser) {
                loadUserHistory(); // Will likely be empty
            }
        } else {
             const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to reset database');
        }
    } catch (error) {
        console.error('Reset error:', error);
        alert('Failed to reset database: ' + error.message);
    }
}

// Initial setup: Add reset button if admin
function setupAdminPanel() {
    if (currentUser && currentUser.username === 'admin') {
        const existingPanel = document.querySelector('.admin-panel');
        if (!existingPanel) {
            const adminPanelHtml = `
                <div class="admin-panel mt-4">
                    <button class="btn btn-warning" onclick="resetDatabase()">
                        <i class="fas fa-database"></i> Reset Database
                    </button>
                </div>
            `;
            // Append to the main container or a specific admin section if you have one
            const mainContainer = document.querySelector('.container');
            if (mainContainer) {
                 mainContainer.insertAdjacentHTML('beforeend', adminPanelHtml);
            }
        }
    }
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    checkAuth().then(() => {
        setupAdminPanel();
        showSection('homeSection');
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

// Suggestion chip event listeners (ensure chips exist)
if (suggestionChips && suggestionChips.length > 0) {
    suggestionChips.forEach(chip => {
        chip.addEventListener('click', () => {
            const prompt = chip.getAttribute('data-prompt');
            if (promptInput) {
                promptInput.value = prompt;
                 // Optionally trigger generation on chip click
                 // generateImage(prompt);
            }
        });
    });
}

if (loginBtn) {
    loginBtn.addEventListener('click', () => {
        // Assuming Bootstrap modals are used
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
        // Redirect or show a default section after logout
        showSection('homeSection');
        // Clear history view after logout
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
                setupAdminPanel(); // Check for admin after login
                // Hide modal
                const loginModalElement = document.getElementById('loginModal');
                 if (loginModalElement) {
                    const modal = bootstrap.Modal.getInstance(loginModalElement);
                    if (modal) modal.hide();
                 }
                 // Clear form
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
                 setupAdminPanel(); // Check for admin after registration
                 // Hide modal
                 const registerModalElement = document.getElementById('registerModal');
                 if (registerModalElement) {
                    const modal = bootstrap.Modal.getInstance(registerModalElement);
                    if (modal) modal.hide();
                 }
                 // Clear form
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