// Configuration
const API_BASE = 'https://securepass-backend.devbytho.workers.dev';
let currentUser = null;
let authToken = null;
let currentPasswordId = null;
let allPasswords = [];
let currentAction = 'view'; 
let currentPasswordForSharing = null;
let isSharedPassword = false;
let isFamilyVaultPassword = false;
let html5QrCode = null;


// DOM Elements
const authScreens = {
    login: document.getElementById('loginScreen'),
    register: document.getElementById('registerScreen'),
    verify: document.getElementById('verifyScreen'),
    forgotPassword: document.getElementById('forgotPasswordScreen'),
    resetPassword: document.getElementById('resetPasswordScreen')
};

const dashboardViews = {
    dashboard: document.getElementById('dashboardView'),
    passwords: document.getElementById('passwordsView'),
    sharingCenter: document.getElementById('sharingCenterView'),
    familySharing: document.getElementById('familySharingView'),
    subscription: document.getElementById('subscriptionView'),
    security: document.getElementById('securityView'),
    activityLog: document.getElementById('activityLogView'),
    settings: document.getElementById('settingsView')
};

// --- ZKA CRYPTO HELPERS ---


function generateSalt() {
    const array = new Uint8Array(16);
    window.crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}


async function deriveMasterKey(password, salt) {
    const enc = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
        "raw", 
        enc.encode(password), 
        { name: "PBKDF2" }, 
        false, 
        ["deriveBits", "deriveKey"]
    );

    const derivedBits = await window.crypto.subtle.deriveBits(
        {
            name: "PBKDF2",
            salt: enc.encode(salt),
            iterations: 100000,
            hash: "SHA-256"
        },
        keyMaterial,
        256
    );

    return derivedBits; 
}


async function deriveAuthKey(masterKeyBuffer) {
    const authKeyBuffer = await window.crypto.subtle.digest(
        "SHA-256",
        masterKeyBuffer
    );
    
    return Array.from(new Uint8Array(authKeyBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}


let sessionMasterKey = null;


function buf2hex(buffer) {
    return [...new Uint8Array(buffer)]
        .map(x => x.toString(16).padStart(2, '0'))
        .join('');
}


function hex2buf(hexString) {
    if (!hexString) return new Uint8Array(0);
    return new Uint8Array(hexString.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
}


async function importAESKey(rawKeyBuffer) {
    return window.crypto.subtle.importKey(
        "raw",
        rawKeyBuffer,
        "AES-GCM",
        false,
        ["encrypt", "decrypt"]
    );
}

async function encryptData(plaintext, rawKeyBuffer) {
    const key = await importAESKey(rawKeyBuffer);
    const iv = window.crypto.getRandomValues(new Uint8Array(12)); // 12 bytes IV
    const enc = new TextEncoder();
    
    const ciphertext = await window.crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        key,
        enc.encode(plaintext)
    );

    return `${buf2hex(iv)}:${buf2hex(ciphertext)}`;
}


async function decryptData(packedData, rawKeyBuffer) {
    try {
        if (!packedData || !packedData.includes(':')) return "";
        const [ivHex, cipherHex] = packedData.split(':');
        const iv = hex2buf(ivHex);
        const ciphertext = hex2buf(cipherHex);
        const key = await importAESKey(rawKeyBuffer);

        const decryptedBuffer = await window.crypto.subtle.decrypt(
            { name: "AES-GCM", iv: iv },
            key,
            ciphertext
        );

        const dec = new TextDecoder();
        return dec.decode(decryptedBuffer);
    } catch (e) {
        console.error("Decryption failed:", e);
        return "[Decryption Error]"; 
    }
}


function saveKeyToSession(rawKeyBuffer) {
    const bytes = new Uint8Array(rawKeyBuffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    
    localStorage.setItem("ep_session_key", base64);
}

async function loadKeyFromSession() { 
    const base64 = localStorage.getItem("ep_session_key");
    
    if (!base64) return null;
    try {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    } catch (e) {
        console.error("Failed to restore key", e);
        return null;
    }
}


async function generateKeyPair() {
    return await window.crypto.subtle.generateKey(
        {
            name: "RSA-OAEP",
            modulusLength: 2048,
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: "SHA-256"
        },
        true, // Extractable
        ["encrypt", "decrypt"]
    );
}


async function exportKeyAsJSON(key) {
    const exported = await window.crypto.subtle.exportKey("jwk", key);
    return JSON.stringify(exported);
}


async function importKeyFromJSON(jsonString, type) { // type = "public" or "private"
    const jwk = JSON.parse(jsonString);
    return await window.crypto.subtle.importKey(
        "jwk",
        jwk,
        { name: "RSA-OAEP", hash: "SHA-256" },
        true,
        type === "public" ? ["encrypt"] : ["decrypt"]
    );
}


let sessionPrivateKey = null;


async function encryptRSA(dataBuffer, publicKey) {
    const encrypted = await window.crypto.subtle.encrypt(
        { name: "RSA-OAEP" },
        publicKey,
        dataBuffer
    );
    return buf2hex(encrypted);
}


async function decryptRSA(hexString, privateKey) {
    const buffer = hex2buf(hexString);
    const decrypted = await window.crypto.subtle.decrypt(
        { name: "RSA-OAEP" },
        privateKey,
        buffer
    );
    return decrypted; // Returns ArrayBuffer
}


async function generateEphemeralKey() {
    return await window.crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
    );
}


async function exportRawKey(key) {
    return await window.crypto.subtle.exportKey("raw", key);
}


async function getAuthKeyForPassword(email, password) {
    // 1. Fetch Salt
    const saltRes = await fetch(`${API_BASE}/api/auth/salt?email=${encodeURIComponent(email)}`);
    const saltData = await saltRes.json();
    
    if (!saltData || !saltData.salt) {
        throw new Error("User not found or invalid credentials");
    }

    // 2. Derive Keys
    const masterKeyBuffer = await deriveMasterKey(password, saltData.salt);
    const authKeyHex = await deriveAuthKey(masterKeyBuffer);
    
    return authKeyHex;
}


function generateInviteCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    const randomVals = new Uint8Array(8);
    window.crypto.getRandomValues(randomVals);
    
    for(let i=0; i<8; i++) {
        code += chars[randomVals[i] % chars.length];
        if(i === 3) code += "-";
    }
    return code;
}


async function deriveKeyFromInviteCode(code) {
    const enc = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
        "raw", enc.encode(code), { name: "PBKDF2" }, false, ["deriveKey", "deriveBits"]
    );
    
    // Fixed salt for invitations
    const salt = enc.encode("securepass-invite-salt-v1"); 

    return await window.crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: salt, iterations: 100000, hash: "SHA-256" },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
    );
}


async function hashInviteCode(code) {
    const enc = new TextEncoder();
    const hashBuffer = await window.crypto.subtle.digest("SHA-256", enc.encode(code));
    return buf2hex(hashBuffer);
}

async function exportInviteKey(cryptoKey) {
    return await window.crypto.subtle.exportKey("raw", cryptoKey);
}


function showAuthScreen(screenId) {
    Object.values(authScreens).forEach(screen => {
        if (screen) {
            screen.classList.add('hidden');
            screen.style.display = 'none';
        }
    });

    const targetScreen = document.getElementById(screenId);
    if (targetScreen) {
        targetScreen.classList.remove('hidden');
        targetScreen.style.display = 'block';
    }
}

function showDashboardView(viewName, clickedElement = null) {
    console.log('Switching to view:', viewName);
    
    // Hide all views - use both class and inline style for reliability
    Object.values(dashboardViews).forEach(view => {
        if (view) {
            view.classList.add('hidden');
            view.style.display = 'none';
        }
    });
    

    const targetView = document.getElementById(viewName + 'View');
    if (targetView) {
        targetView.classList.remove('hidden');
        targetView.style.display = 'block';
        console.log('View displayed:', viewName + 'View');
    } else {
        console.error('View not found:', viewName + 'View');
        return;
    }
    
    document.querySelectorAll('.nav-links a').forEach(link => {
        link.classList.remove('active');
    });
    
    if (clickedElement) {
        clickedElement.classList.add('active');
    } else {
        const navLink = document.querySelector(`.nav-links a[data-arg="${viewName}"]`);
        if (navLink) {
            navLink.classList.add('active');
        }
    }
    
    if (viewName === 'dashboard') {
        console.log('Updating dashboard view with current passwords...');
        updatePasswordLists();
        loadDashboardData();
    } else if (viewName === 'passwords') {
        console.log('Updating passwords view with current passwords...');
        updatePasswordLists();
    }


    if (viewName === 'subscription') {
        updateSubscriptionView(currentUser?.plan || 'free');
    }
    
    
    if (viewName === 'settings') {
        updateSettingsView();
    }
    
    // Load content based on user's plan
    loadViewContent(viewName);
}

function updateSettingsView() {
  const familySection = document.getElementById('familyManagementSection');
  const deleteFamilyItem = document.getElementById('deleteFamilyItem');
  const leaveFamilyItem = document.getElementById('leaveFamilyItem');
  const childAccountMessage = document.getElementById('childAccountMessage');
  
  if (!familySection || !deleteFamilyItem || !leaveFamilyItem || !childAccountMessage) {
    console.warn('Family management elements not found');
    return;
  }
  
  if (currentUser?.plan === 'family') {
    familySection.classList.remove('hidden');
    
    checkFamilyOwnershipAndRole().then(({ isOwner, role, hasFamily }) => {
      if (hasFamily === false) {
        deleteFamilyItem.classList.add('hidden');
        leaveFamilyItem.classList.add('hidden');
        childAccountMessage.classList.add('hidden');
        return;
      }
      
      if (isOwner) {
        // Owner can delete the whole family
        deleteFamilyItem.classList.remove('hidden');
        leaveFamilyItem.classList.add('hidden');
        childAccountMessage.classList.add('hidden');
      } else if (role === 'parent') {
        // Parent can leave the family
        deleteFamilyItem.classList.add('hidden');
        leaveFamilyItem.classList.remove('hidden');
        childAccountMessage.classList.add('hidden');
      } else {
        // Child account - show message only
        deleteFamilyItem.classList.add('hidden');
        leaveFamilyItem.classList.add('hidden');
        childAccountMessage.classList.remove('hidden');
      }
    }).catch(error => {
      console.error('Error checking family ownership:', error);
      deleteFamilyItem.classList.add('hidden');
      leaveFamilyItem.classList.add('hidden');
      childAccountMessage.classList.add('hidden');
    });
  } else {
    familySection.classList.add('hidden');
  }
}
async function checkFamilyOwnershipAndRole() {
  try {
    const result = await apiCall('/api/family');
    if (result.family) {
      const userMember = result.family.members.find(member => member.id === currentUser.id);
      return {
        isOwner: result.family.owner_id === currentUser.id,
        role: userMember ? userMember.role : 'child',
        hasFamily: true
      };
    }
    return { isOwner: false, role: null, hasFamily: false };
  } catch (error) {
    console.error('Error checking family ownership:', error);
    if (error.message.includes('404') || error.message.includes('not found')) {
      return { isOwner: false, role: null, hasFamily: false };
    }
    return { isOwner: false, role: 'child', hasFamily: false };
  }
}

function loadViewContent(viewName) {
    const userPlan = currentUser?.plan || 'free';
    
    switch(viewName) {
        case 'sharingCenter':
            loadSharingCenterContent(userPlan);
            break;
        case 'familySharing':
            loadFamilySharingContent(userPlan);
            break;
        case 'security':
            loadSecurityContent(userPlan);
            break;
        case 'activityLog':
            loadActivityLogContent(userPlan);
            break;
    }
}

async function loadSharingCenterContent(userPlan) {
    const contentDiv = document.getElementById('sharingCenterContent');
    
    if (userPlan === 'free') {
        contentDiv.innerHTML = `
            <div class="feature-access">
                <i class="fas fa-share-alt feature-access-icon"></i>
                <h2 class="feature-access-title">Sharing Center</h2>
                <p class="feature-access-description">Share passwords securely with team members and trusted contacts. Collaborate without compromising security.</p>
                <div class="required-plan">Requires Premium Plan</div>
                <button class="btn btn-primary upgrade-btn-feature" data-action="showDashboardView" data-arg="subscription">
                    Upgrade to Premium
                </button>
            </div>
            <div class="premium-benefits">
                <div class="benefit-card">
                    <div class="benefit-icon">
                        <i class="fas fa-users"></i>
                    </div>
                    <h3 class="benefit-title">Team Sharing</h3>
                    <p class="benefit-description">Share passwords securely with your team members with customizable access levels and permissions.</p>
                </div>
                <div class="benefit-card">
                    <div class="benefit-icon">
                        <i class="fas fa-clock"></i>
                    </div>
                    <h3 class="benefit-title">Temporary Access</h3>
                    <p class="benefit-description">Grant time-limited access to shared passwords that automatically revokes when the time expires.</p>
                </div>
                 <div class="benefit-card">
                    <div class="benefit-icon">
                        <i class="fas fa-qrcode"></i>
                    </div>
                    <h3 class="benefit-title">QR Code Sharing</h3>
                    <p class="benefit-description">Share passwords instantly and securely using a single-use, time-limited QR code.</p>
                </div>
            </div>
        `;
    } else {
        try {
            const result = await apiCall('/api/shared-passwords');
            const sharedWithMe = result.sharedWithMe || [];
            const sharedByMe = result.sharedByMe || [];

            contentDiv.innerHTML = `
                <div class="password-list">
                    <div class="list-header">
                        <div class="list-title">Shared With Me</div>
                        <button class="add-btn" data-action="showClaimModal">
                            <i></i> Redeem Code
                        </button>
                    </div>
                    <div id="sharedWithMeList">
                        ${sharedWithMe.length === 0 ? `
                            <div class="empty-state">
                                <i class="fas fa-users"></i>
                                <h3>No passwords shared with you</h3>
                                <p>When someone shares a password with you, it will appear here</p>
                            </div>
                        ` : sharedWithMe.map(share => `
                            <div class="password-item">
                                <div class="password-icon">${share.website.charAt(0).toUpperCase()}</div>
                                <div class="password-details">
                                    <div class="password-name">${share.website}</div>
                                    <div class="password-username">Shared by: ${share.shared_by_name}</div>
                                </div>
                                <div class="password-actions">
                                    <button class="action-btn view-password" data-id="${share.id}" data-shared="true">
                                        <i class="fas fa-eye"></i>
                                    </button>
                                    <button class="action-btn copy-password" data-id="${share.id}" data-shared="true">
                                        <i class="fas fa-copy"></i>
                                    </button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
                
                <div class="mt-32">
                    <div class="list-header">
                        <div class="list-title">Shared By Me</div>
                    </div>
                    <div id="sharedByMeList">
                        ${sharedByMe.length === 0 ? `
                            <div class="empty-state empty-state-padding">
                                <i class="fas fa-share-alt"></i>
                                <h3>No passwords shared yet</h3>
                                <p>You can share passwords from the 'All Passwords' section.</p>
                            </div>
                        ` : sharedByMe.map(share => `
                            <div class="password-item">
                                <div class="password-icon">${share.website.charAt(0).toUpperCase()}</div>
                                <div class="password-details">
                                    <div class="password-name">${share.website}</div>
                                    <div class="password-username">Shared with: ${share.shared_with_name}</div>
                                </div>
                                <div class="password-actions">
                                    <!-- 👇 THIS IS THE FIX 👇 -->
                                    <button class="action-btn view-password" data-id="${share.password_id}">
                                        <i class="fas fa-eye"></i>
                                    </button>
                                    <button class="action-btn copy-password" data-id="${share.password_id}">
                                        <i class="fas fa-copy"></i>
                                    </button>
                                            <button class="action-btn" data-action="revokeShare" data-arg="${share.id}" title="Revoke Share">
                                                <i class="fas fa-times"></i>
                                            </button>
                                    <!-- 👆 END OF FIX 👆 -->
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;

            setTimeout(() => {
                // Listener for "Shared WITH Me"
                const withMeBtns = document.querySelectorAll('#sharedWithMeList .view-password, #sharedWithMeList .copy-password');
                withMeBtns.forEach(btn => {
                    btn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        const shareId = this.getAttribute('data-id');
                        const isShared = this.getAttribute('data-shared') === 'true'; 
                        
                        if (this.classList.contains('view-password')) {
                            showPasswordDetails(shareId, isShared);
                        } else {
                            copyPasswordToClipboard(shareId, isShared);
                        }
                    });
                });
                
                const byMeBtns = document.querySelectorAll('#sharedByMeList .view-password, #sharedByMeList .copy-password');
                byMeBtns.forEach(btn => {
                    btn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        const passwordId = this.getAttribute('data-id');
                        if (this.classList.contains('view-password')) {
                            showPasswordDetails(passwordId, false);
                        } else {
                            copyPasswordToClipboard(passwordId, false);
                        }
                    });
                });
                
                document.querySelectorAll('.revoke-share').forEach(btn => {
                    btn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        revokeShare(this.getAttribute('data-id'));
                    });
                });

            }, 100);

        } catch (error) {
            console.error('Error loading shared passwords:', error);
            contentDiv.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-exclamation-triangle"></i>
                    <h3>Error loading shared passwords</h3>
                    <p>Please try again later</p>
                </div>
            `;
        }
    }
}

async function loadFamilySharingContent(userPlan) {
    const contentDiv = document.getElementById('familySharingContent');
    
    
    let pendingInvitations = [];
    try {
        const invitationsResult = await apiCall('/api/family/my-invitations');
        pendingInvitations = invitationsResult.invitations || [];
    } catch (error) {
        console.error('Error loading invitations:', error);
    }

    const invitationsSection = pendingInvitations.length > 0 ? `
        <div class="password-list mb-32">
            <div class="list-header">
                <div class="list-title">Pending Family Invitations</div>
                <div class="card-description">You have ${pendingInvitations.length} pending invitation(s)</div>
            </div>
            <div id="pendingInvitationsList">
                ${pendingInvitations.map(invite => `
                    <div class="password-item">
                        <div class="password-icon password-icon-warning">
                            <i class="fas fa-envelope"></i>
                        </div>
                        <div class="password-details">
                            <div class="password-name">${invite.family_name}</div>
                            <div class="password-username">
                                Invited by: ${invite.owner_name} (${invite.owner_email})
                            </div>
                            <div class="password-username">
                                Role: ${invite.role} • Expires: ${new Date(invite.expires_at).toLocaleDateString()}
                            </div>
                        </div>
                        <div class="password-actions">
                            <button class="action-btn accept-invite" data-token="${invite.token}" title="Accept Invitation">
                                <i class="fas fa-check icon-success"></i>
                            </button>
                            <button class="action-btn decline-invite" data-token="${invite.token}" title="Decline Invitation">
                                <i class="fas fa-times icon-danger"></i>
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    ` : `
        <div class="empty-state mb-32">
            <i class="fas fa-envelope-open"></i>
            <h3>No pending invitations</h3>
            <p>When someone invites you to their family, it will appear here</p>
        </div>
    `;

    if (userPlan === 'free' || userPlan === 'premium') {
        contentDiv.innerHTML = `
            ${invitationsSection}
            
            <div class="feature-access">
                <i class="fas fa-user-friends feature-access-icon"></i>
                <h2 class="feature-access-title">Family Sharing</h2>
                <p class="feature-access-description">
                    ${userPlan === 'free' 
                        ? 'You can join family groups when invited. Upgrade to Family plan to create your own family and invite members.' 
                        : 'You can join family groups when invited. Upgrade to Family plan to create your own family and invite members.'}
                </p>
                ${userPlan === 'free' ? `
                    <div class="required-plan">Create Family: Requires Family Plan</div>
                    <button class="btn btn-primary upgrade-btn-feature" data-action="showDashboardView" data-arg="subscription">
                        Upgrade to Family
                    </button>
                ` : ''}
            </div>
        `;
    } 
    else if (userPlan === 'family') {
        try {
            const result = await apiCall('/api/family');
            const family = result.family;
            
            if (!family) {
                contentDiv.innerHTML = `
                    ${invitationsSection}
                    
                    <div class="feature-access">
                        <i class="fas fa-home feature-access-icon"></i>
                        <h2 class="feature-access-title">Create Your Family Group</h2>
                        <p class="feature-access-description">Start by creating a family group to share passwords securely with your family members.</p>
                <button class="btn btn-primary upgrade-btn-feature" data-action="showCreateFamilyModal">
                                    Create Family Group
                                </button>
                    </div>
                `;
                return;
            }

            const vaultResult = await apiCall('/api/family/vault/passwords');
            const vaultPasswords = vaultResult.passwords || [];

            const emergencyAccessSection = family.emergencyAccess && family.emergencyAccess.enabled ? `
                <div class="emergency-access-banner">
                    <i class="fas fa-exclamation-triangle emergency-icon"></i>
                    <strong>Emergency Access Active</strong>
                    <p class="emergency-text">
                        All family members have access to shared passwords for emergency purposes.
                    </p>
                    <button class="btn btn-secondary emergency-btn" data-action="disableEmergencyAccess">
                        Disable Emergency Access
                    </button>
                </div>
            ` : '';

            contentDiv.innerHTML = `
                ${invitationsSection}
                ${emergencyAccessSection}
                
                <div class="password-list">
                    <div class="list-header">
                        <div class="list-title">Family Members</div>
                        <button class="add-btn" data-action="showInviteFamilyModal">
                            <i class="fas fa-user-plus"></i> Invite Member
                        </button>
                    </div>
                    <div id="familyMembersList">
                        ${family.members.map(member => `
                            <div class="family-member-card">
                                <div class="family-member-avatar">
                                    ${member.name.charAt(0).toUpperCase()}
                                </div>
                                <div class="family-member-info">
                                    <div class="family-member-name">${member.name}</div>
                                    <div class="family-member-role">
                                        ${member.role} ${member.id === family.owner_id ? '(Owner)' : ''}
                                    </div>
                                </div>
                                ${member.id !== family.owner_id && family.owner_id === currentUser.id ? `
                                    <div class="password-actions">
                                        <button class="action-btn" data-action="removeFamilyMember" data-arg="${member.id}" title="Remove Member">
                                            <i class="fas fa-times"></i>
                                        </button>
                                    </div>
                                ` : ''}
                            </div>
                        `).join('')}
                    </div>
                </div>
                
                <div class="mt-32">
                    <div class="list-header">
                        <div class="list-title">Family Vault</div>
                        <div class="vault-buttons-container">
                            <button class="add-btn" data-action="showAddFamilyVaultModal">
                                <i class="fas fa-plus"></i> Add to Vault
                            </button>
                            ${family.owner_id === currentUser.id ? `
                                <button class="add-btn" data-action="enableEmergencyAccess">
                                    <i class="fas fa-shield-alt"></i> Enable Emergency Access
                                </button>
                            ` : ''}
                        </div>
                    </div>
                    <div id="familyVaultContent">
                        ${vaultPasswords.length === 0 ? `
                            <div class="empty-state empty-state-padding">
                                <i class="fas fa-home"></i>
                                <h3>Family vault is empty</h3>
                                <p>Add passwords to the family vault to share with family members</p>
                            </div>
                        ` : vaultPasswords.map(password => `
                            <div class="password-item">
                                <div class="password-icon">${password.website.charAt(0).toUpperCase()}</div>
                                <div class="password-details">
                                    <div class="password-name">${password.website}</div>
                                    <div class="password-username">
                                        ${password.username} • Added by: ${password.added_by_name}
                                    </div>
                                    <div class="password-username icon-info-small">
                                        <i class="fas fa-users"></i> ${password.share_with_name}
                                    </div>
                                </div>
                                <div class="password-actions">
                                    <button class="action-btn view-password" data-id="${password.id}" data-family-vault="true">
                                        <i class="fas fa-eye"></i>
                                    </button>
                                    <button class="action-btn copy-password" data-id="${password.id}" data-family-vault="true">
                                        <i class="fas fa-copy"></i>
                                    </button>
                                    ${password.added_by_user_id === currentUser.id || family.owner_id === currentUser.id ? `
                                        <button class="action-btn delete-password" data-id="${password.id}" data-family-vault="true">
                                            <i class="fas fa-trash"></i>
                                        </button>
                                    ` : ''}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;

            setTimeout(() => {
                document.querySelectorAll('#familyVaultContent .view-password').forEach(btn => {
                    btn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        const passwordId = this.getAttribute('data-id');
                        const isFamilyVault = this.getAttribute('data-family-vault') === 'true';
                        showFamilyVaultPasswordDetails(passwordId);
                    });
                });

                document.querySelectorAll('#familyVaultContent .copy-password').forEach(btn => {
                    btn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        const passwordId = this.getAttribute('data-id');
                        const isFamilyVault = this.getAttribute('data-family-vault') === 'true';
                        copyFamilyVaultPassword(passwordId);
                    });
                });

                document.querySelectorAll('#familyVaultContent .delete-password').forEach(btn => {
                    btn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        const passwordId = this.getAttribute('data-id');
                        const isFamilyVault = this.getAttribute('data-family-vault') === 'true';
                        removeFromFamilyVault(passwordId);
                    });
                });

            }, 100);

        } catch (error) {
            console.error('Error loading family data:', error);
            contentDiv.innerHTML = `
                ${invitationsSection}
                
                <div class="empty-state">
                    <i class="fas fa-exclamation-triangle"></i>
                    <h3>Error loading family data</h3>
                    <p>Please try again later</p>
                </div>
            `;
        }
    }
}

function loadSecurityContent(userPlan) {
    const contentDiv = document.getElementById('securityContent');
    
    if (userPlan === 'free') {
        contentDiv.innerHTML = `
            <div class="feature-access">
                <i class="fas fa-shield-alt feature-access-icon"></i>
                <h2 class="feature-access-title">Advanced Security</h2>
                <p class="feature-access-description">Enhanced security features to protect your digital life with enterprise-grade protection.</p>
                <div class="required-plan">Requires Premium Plan</div>
                <button class="btn btn-primary upgrade-btn-feature" data-action="showDashboardView" data-arg="subscription">
                    Upgrade to Premium
                </button>
            </div>
            <div class="premium-benefits">
                <div class="benefit-card">
                    <div class="benefit-icon">
                        <i class="fas fa-fingerprint"></i>
                    </div>
                    <h3 class="benefit-title">Biometric Lock</h3>
                    <p class="benefit-description">Secure your vault with fingerprint or face recognition for quick and secure access.</p>
                </div>
                <div class="benefit-card">
                    <div class="benefit-icon">
                        <i class="fas fa-history"></i>
                    </div>
                    <h3 class="benefit-title">Auto-Logout</h3>
                    <p class="benefit-description">Automatic logout after inactivity for added security and peace of mind.</p>
                </div>
                <div class="benefit-card">
                    <div class="benefit-icon">
                        <i class="fas fa-bell"></i>
                    </div>
                    <h3 class="benefit-title">Security Alerts</h3>
                    <p class="benefit-description">Get notified of suspicious activity, breaches, and security recommendations.</p>
                </div>
            </div>
        `;
    } else if (userPlan === 'premium' || userPlan === 'family') {
        contentDiv.innerHTML = `
            <div class="settings-container">
                <div class="settings-section">
                    <div class="settings-title">Advanced Security Features</div>
                    <div class="settings-item">
                        <div>
                            <div class="settings-label">Biometric Authentication</div>
                            <div class="settings-description">Use fingerprint or face recognition for quick access</div>
                        </div>
                        <label class="toggle-switch">
                            <input type="checkbox" id="advancedBiometricToggle" checked>
                            <span class="toggle-slider"></span>
                        </label>
                    </div>
                    <div class="settings-item">
                        <div>
                            <div class="settings-label">Auto-Logout</div>
                            <div class="settings-description">Automatically log out after 15 minutes of inactivity</div>
                        </div>
                        <label class="toggle-switch">
                            <input type="checkbox" id="autoLogoutToggle" checked>
                            <span class="toggle-slider"></span>
                        </label>
                    </div>
                    <div class="settings-item">
                        <div>
                            <div class="settings-label">Security Alerts</div>
                            <div class="settings-description">Receive notifications for suspicious activity</div>
                        </div>
                        <label class="toggle-switch">
                            <input type="checkbox" id="securityAlertsToggle" checked>
                            <span class="toggle-slider"></span>
                        </label>
                    </div>
                </div>
                
                <div class="settings-section">
                    <div class="settings-title">Security Reports</div>
                    <div class="settings-item">
                        <div>
                            <div class="settings-label">Last Security Scan</div>
                            <div class="settings-description">Completed 2 hours ago - No issues found</div>
                        </div>
                        <button class="btn btn-secondary">Run Scan</button>
                    </div>
                    <div class="settings-item">
                        <div>
                            <div class="settings-label">Breach Monitoring</div>
                            <div class="settings-description">Monitoring 15 passwords for data breaches</div>
                        </div>
                        <button class="btn btn-secondary">View Report</button>
                    </div>
                </div>
            </div>
        `;
    }
}

async function loadActivityLogContent(userPlan) {
    const contentDiv = document.getElementById('activityLogContent');
    
    if (userPlan === 'free') {
        contentDiv.innerHTML = `
            <div class="feature-access">
                <i class="fas fa-history feature-access-icon"></i>
                <h2 class="feature-access-title">Activity Log</h2>
                <p class="feature-access-description">Monitor all access, logins, and changes to your password vault with a detailed audit trail for enhanced security.</p>
                <div class="required-plan">Requires Premium Plan</div>
                <button class="btn btn-primary upgrade-btn-feature" data-action="showDashboardView" data-arg="subscription">
                    Upgrade to Premium
                </button>
            </div>
            <div class="premium-benefits">
                <div class="benefit-card">
                    <div class="benefit-icon"><i class="fas fa-list-alt"></i></div>
                    <h3 class="benefit-title">Detailed Logs</h3>
                    <p class="benefit-description">See a complete history of all vault activities, including logins and password changes.</p>
                </div>
                <div class="benefit-card">
                    <div class="benefit-icon"><i class="fas fa-map-marker-alt"></i></div>
                    <h3 class="benefit-title">Location Tracking</h3>
                    <p class="benefit-description">Identify the country and IP address for every important action taken on your account.</p>
                </div>
                <div class="benefit-card">
                    <div class="benefit-icon"><i class="fas fa-download"></i></div>
                    <h3 class="benefit-title">Export Reports</h3>
                    <p class="benefit-description">Download comprehensive activity reports for your personal auditing and security records.</p>
                </div>
            </div>
        `;
        return;
    }

    contentDiv.innerHTML = `
        <div class="password-list">
            <div class="list-header">
                <div class="list-title">Recent Account Activity</div>
                 <div class="log-actions">
                    <button class="btn btn-secondary" data-action="exportActivityLog">
                        <i class="fas fa-download"></i> Export Data
                    </button>
                    <button class="danger-btn" data-action="clearActivityLog">
                        <i class="fas fa-trash"></i> Clear Log
                    </button>
                </div>
            </div>
            <div id="activityLogList">
                <div class="loading">
                    <div class="spinner"></div>
                    <div>Loading activity...</div>
                </div>
            </div>
        </div>`;
    
    document.querySelector('#activityLogList .loading').style.display = 'block';

    try {
        const result = await apiCall('/api/activity-log');
        const logs = result.logs || [];
        const listContainer = document.getElementById('activityLogList');
        listContainer.innerHTML = ''; 

        if (logs.length === 0) {
            listContainer.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-history"></i>
                    <h3>No activity recorded yet</h3>
                    <p>As you use your account, security events will appear here.</p>
                </div>`;
            return;
        }

        logs.forEach(log => {
            const logItem = createLogItemElement(log);
            listContainer.appendChild(logItem);
        });

    } catch (error) {
        document.getElementById('activityLogList').innerHTML = `
            <div class="empty-state">
                <i class="fas fa-exclamation-triangle"></i>
                <h3>Could not load activity</h3>
                <p>${error.message}</p>
            </div>`;
    }
}

 async function exportActivityLog(e) {
    const exportButton = e ? e.target.closest('button') : document.querySelector('[data-action="exportActivityLog"]');
    if (!exportButton) return;
    
    const originalHTML = exportButton.innerHTML;
    exportButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Exporting...';
    exportButton.disabled = true;

    try {
        const result = await apiCall('/api/activity-log?export=true');
        const logs = result.logs;

        if (!logs || logs.length === 0) {
            showNotification('No activity to export.', 'warning');
            return;
        }

        // Convert JSON to CSV
        const headers = ['timestamp', 'action_type', 'details', 'ip_address', 'country_code'];
        const csvRows = [headers.join(',')];
        logs.forEach(log => {
            const values = headers.map(header => {
                const escaped = ('' + log[header]).replace(/"/g, '""'); 
                return `"${escaped}"`;
            });
            csvRows.push(values.join(','));
        });
        const csvString = csvRows.join('\n');

        const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        if (link.download !== undefined) {
            const url = URL.createObjectURL(blob);
            const date = new Date().toISOString().split('T')[0];
            link.setAttribute('href', url);
            link.setAttribute('download', `securepass_activity_log_${date}.csv`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
        
        showNotification('Activity log exported successfully!', 'success');

    } catch (error) {
        showNotification(`Export failed: ${error.message}`, 'error');
    } finally {
        if (exportButton) {
            exportButton.innerHTML = originalHTML;
            exportButton.disabled = false;
        }
    }
}

async function clearActivityLog() {
    if (!confirm('Are you sure you want to permanently delete your entire activity log? This action cannot be undone.')) {
        return;
    }

    try {
        const result = await apiCall('/api/activity-log', {
            method: 'DELETE'
        });

        showNotification(result.message, 'success');
        loadActivityLogContent(currentUser.plan);

    } catch (error) {
        showNotification(`Failed to clear log: ${error.message}`, 'error');
    }
}

function createLogItemElement(log) {
    const item = document.createElement('div');
    item.className = 'log-item';

    let iconClass = 'fa-question-circle';
    let description = log.details || 'An unknown action occurred';

    switch (log.action_type) {
        case 'LOGIN': iconClass = 'fa-sign-in-alt'; description = 'Successful account login'; break;
        case 'ADD_PASSWORD': iconClass = 'fa-plus-circle'; description = `Added a new password: ${log.details.replace(/</g, "&lt;").replace(/>/g, "&gt;")}`; break;
        case 'UPDATE_PASSWORD': iconClass = 'fa-pencil-alt'; description = `Updated a password: ${log.details.replace(/</g, "&lt;").replace(/>/g, "&gt;")}`; break;
    }

    const formattedDate = new Date(log.timestamp).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
    });
    
    let countryTitle = 'Unknown Location';
    const flagUrl = getFlagUrl(log.country_code);


    let flagHtml = `<span class="log-flag" title="${countryTitle}">🌐</span>`;

    if (flagUrl) {
        try {
            countryTitle = new Intl.DisplayNames(['en'], { type: 'region' }).of(log.country_code);
        } catch (e) {
            countryTitle = log.country_code;
        }
        flagHtml = `<img src="${flagUrl}" class="log-flag" title="${countryTitle}" alt="${log.country_code}" width="20" height="15" />`;
    }

    item.innerHTML = `
        <div class="log-icon">
            <i class="fas ${iconClass}"></i>
        </div>
        <div class="log-details">
            <div class="log-description">${description}</div>
            <div class="log-timestamp">${formattedDate}</div>
        </div>
        <div class="log-meta">
            ${flagHtml}
        </div>
    `;
    return item;
}

function showAlert(elementId, message, type = 'error') {
    const alert = document.getElementById(elementId);
    alert.textContent = message;
    alert.className = `alert alert-${type}`;
    alert.style.display = 'block';
    setTimeout(() => {
        alert.style.display = 'none';
    }, 5000);
}

function togglePassword(inputId) {
    if (!inputId) {
        console.error('togglePassword called without inputId');
        return;
    }
    
    const input = document.getElementById(inputId);
    if (!input) {
        console.error('Input element not found:', inputId);
        return;
    }
    
    const icon = input.parentNode.querySelector('i');
    if (!icon) {
        console.error('Icon not found for input:', inputId);
        return;
    }
    
    if (input.type === 'password') {
        input.type = 'text';
        icon.className = 'fas fa-eye-slash';
    } else {
        input.type = 'password';
        icon.className = 'fas fa-eye';
    }
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

function showModal(modalId) {
    document.getElementById(modalId).style.display = 'flex';
}

// Notification function
function showNotification(message, type = 'success') {
    const notification = document.getElementById('successNotification');
    const messageElement = document.getElementById('notificationMessage');
    
    messageElement.textContent = message;
    notification.className = `notification ${type}`;
    notification.classList.add('show');
    
    setTimeout(() => {
        notification.classList.remove('show');
    }, 3000);
}

function toggleDarkMode() {
    document.body.classList.toggle('dark-mode');
    const isDarkMode = document.body.classList.contains('dark-mode');
    localStorage.setItem('darkMode', isDarkMode);
    
    const themeIcon = document.querySelector('#themeToggle i');
    if (isDarkMode) {
        themeIcon.className = 'fas fa-sun';
    } else {
        themeIcon.className = 'fas fa-moon';
    }
}

function initializeDarkMode() {
    const savedDarkMode = localStorage.getItem('darkMode') === 'true';
    const darkModeToggle = document.getElementById('darkModeToggle');
    
    if (savedDarkMode) {
        document.body.classList.add('dark-mode');
        darkModeToggle.checked = true;
        document.querySelector('#themeToggle i').className = 'fas fa-sun';
    } else {
        document.body.classList.remove('dark-mode');
        darkModeToggle.checked = false;
        document.querySelector('#themeToggle i').className = 'fas fa-moon';
    }
}


function toggleBiometricOptions() {
    const biometricToggle = document.getElementById('biometricToggle');
    const biometricOptions = document.getElementById('biometricOptions');
    
    if (biometricToggle.checked) {
        biometricOptions.style.display = 'block';
        if (!window.PublicKeyCredential) {
            showNotification('Biometric authentication is not supported on this device/browser', 'error');
            biometricToggle.checked = false;
            biometricOptions.style.display = 'none';
            return;
        }
        
        initializeBiometricOptions();
    } else {
        biometricOptions.style.display = 'none';
        // Disable all biometric options
        document.getElementById('fingerprintToggle').checked = false;
        document.getElementById('faceRecognitionToggle').checked = false;
    }
}

function initializeBiometricOptions() {
    document.getElementById('fingerprintToggle').disabled = false;
    document.getElementById('faceRecognitionToggle').disabled = false;
}


async function apiCall(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    const config = {
        headers: {
            'Content-Type': 'application/json',
            ...options.headers
        },
        ...options
    };

    if (authToken) {
        config.headers.Authorization = `Bearer ${authToken}`;
    }

    try {
        const response = await fetch(url, config);
        const data = await response.json();
        
        if (!response.ok) {
            if (endpoint === '/api/family' && response.status === 404) {
                return { family: null }; 
            }
            throw new Error(data.error || 'API request failed');
        }
        
        return data;
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
}


async function getUserPlan() {
    try {
        const result = await apiCall('/api/user/plan');
        return result.plan || 'free';
    } catch (error) {
        console.error('Error getting user plan:', error);
        return 'free';
    }
}

// Update subscription view based on current plan
function updateSubscriptionView(currentPlan) {
    const freePlanCard = document.getElementById('freePlanCard');
    const premiumPlanCard = document.getElementById('premiumPlanCard');
    const familyPlanCard = document.getElementById('familyPlanCard');
    
    const premiumPlanBtn = document.getElementById('premiumPlanBtn');
    const familyPlanBtn = document.getElementById('familyPlanBtn');
    
    const premiumCancelSection = document.getElementById('premiumCancelSection');
    const familyCancelSection = document.getElementById('familyCancelSection');
    
    const currentPlanDisplay = document.getElementById('currentPlanDisplay');
    const planDescription = document.getElementById('planDescription');
    const missingFeatures = document.getElementById('missingFeatures');

    premiumPlanCard.classList.remove('featured');
    familyPlanCard.classList.remove('featured');

    premiumPlanBtn.style.display = 'block';
    familyPlanBtn.style.display = 'block';
    premiumCancelSection.style.display = 'none';
    familyCancelSection.style.display = 'none';
    
    if (currentPlan === 'free') {
        freePlanCard.style.display = 'block';
        missingFeatures.style.display = 'block';
        currentPlanDisplay.textContent = 'Free';
        planDescription.textContent = 'You\'re currently on the Free plan with basic features.';
        
        // Add featured styling to premium plan
        premiumPlanCard.classList.add('featured');
        
        premiumPlanBtn.textContent = 'Upgrade to Premium';
        premiumPlanBtn.setAttribute('data-action', 'upgradePlan');
        premiumPlanBtn.setAttribute('data-arg', 'premium');
        premiumPlanBtn.removeAttribute('onclick');
        
        familyPlanBtn.textContent = 'Choose Family Plan';
        familyPlanBtn.setAttribute('data-action', 'upgradePlan');
        familyPlanBtn.setAttribute('data-arg', 'family');
        familyPlanBtn.removeAttribute('onclick');
        
    } else if (currentPlan === 'premium') {
        freePlanCard.style.display = 'none';
        missingFeatures.style.display = 'none';
        currentPlanDisplay.textContent = 'Premium';
        planDescription.textContent = 'You\'re enjoying all Premium features. You can upgrade to Family or cancel your subscription.';
        
        // Add featured styling to family plan
        familyPlanCard.classList.add('featured');
        
        premiumPlanBtn.style.display = 'none';
        premiumCancelSection.style.display = 'block';
        
        familyPlanBtn.textContent = 'Switch to Family Plan';
        familyPlanBtn.setAttribute('data-action', 'upgradePlan');
        familyPlanBtn.setAttribute('data-arg', 'family');
        familyPlanBtn.removeAttribute('onclick');
        
        const cancelPremiumBtn = document.getElementById('cancelPremiumBtn');
        cancelPremiumBtn.setAttribute('data-action', 'cancelSubscription');
        cancelPremiumBtn.setAttribute('data-arg', 'premium');
        cancelPremiumBtn.removeAttribute('onclick');
        
    } else if (currentPlan === 'family') {
        freePlanCard.style.display = 'none';
        missingFeatures.style.display = 'none';
        currentPlanDisplay.textContent = 'Family';
        planDescription.textContent = 'You\'re enjoying all Family features. You can switch to Premium or cancel your subscription.';
        
        // Add featured styling to premium plan
        premiumPlanCard.classList.add('featured');
        
        familyPlanBtn.style.display = 'none';
        familyCancelSection.style.display = 'block';
        
        premiumPlanBtn.textContent = 'Switch to Premium Plan';
        premiumPlanBtn.setAttribute('data-action', 'upgradePlan');
        premiumPlanBtn.setAttribute('data-arg', 'premium');
        premiumPlanBtn.removeAttribute('onclick');
        
        const cancelFamilyBtn = document.getElementById('cancelFamilyBtn');
        cancelFamilyBtn.setAttribute('data-action', 'cancelSubscription');
        cancelFamilyBtn.setAttribute('data-arg', 'family');
        cancelFamilyBtn.removeAttribute('onclick');
    }
}


async function upgradePlan(planName) {
    try {
        const result = await apiCall('/api/auth/upgrade-plan', {
            method: 'POST',
            body: JSON.stringify({ plan: planName })
        });

        currentUser.plan = planName;
        
        updatePlanUI(planName);
        updateSubscriptionView(planName);
        updateSettingsView();
        
        showNotification(`Successfully upgraded to ${planName} plan!`);
        
    } catch (error) {
        showNotification('Error upgrading plan: ' + error.message, 'error');
    }
}


async function cancelSubscription(currentPlan) {
    document.getElementById('pinModalTitle').textContent = 'Verify PIN to Cancel Subscription';
    document.getElementById('pinModalDescription').textContent = 'For security reasons, please enter your PIN to cancel your subscription.';
    
    currentAction = 'cancel_subscription';
    setupPinInputs();
    showModal('pinModal');
    
    window.pendingCancellationPlan = currentPlan;
}

// Handle subscription cancellation after PIN verification
async function processSubscriptionCancellation(pin) {
    try {
        const verifyResult = await apiCall('/api/auth/verify-pin', {
            method: 'POST',
            body: JSON.stringify({ pin })
        });

        if (!verifyResult.success) {
            throw new Error('Invalid PIN');
        }

        const currentPlan = window.pendingCancellationPlan;

        // If cancelling family plan, delete the family group first
        if (currentPlan === 'family') {
            try {
                await apiCall('/api/family', {
                    method: 'DELETE'
                });
                showNotification('Family group deleted and subscription cancelled.');
            } catch (familyError) {
                console.error('Family deletion failed:', familyError);
                showNotification('Subscription cancelled, but could not delete family group.', 'warning');
            }
        }

        // Downgrade to free plan
        const result = await apiCall('/api/auth/upgrade-plan', {
            method: 'POST',
            body: JSON.stringify({ plan: 'free' })
        });

        // Update current user plan
        currentUser.plan = 'free';
        
        // Update UI to reflect cancellation
        updatePlanUI('free');
        updateSubscriptionView('free');
        updateSettingsView();
        
        showNotification('Subscription cancelled successfully. You have been downgraded to the Free plan.');
        
    } catch (error) {
        showNotification('Error cancelling subscription: ' + error.message, 'error');
        throw error;
    }
}



async function verifyPin() {
    const inputs = document.querySelectorAll('#pinModal .pin-input');
    const pin = Array.from(inputs).map(input => input.value).join('');

    if (pin.length !== 4) {
        showNotification('Please enter a valid 4-digit PIN', 'error');
        return;
    }

    try {
        inputs.forEach(input => input.value = '');

        if (currentAction === 'view') {
            if (isSharedPassword) {
                await loadSharedPasswordDetails(currentPasswordId, pin);
            } else if (isFamilyVaultPassword) {
                await loadFamilyVaultPasswordDetails(currentPasswordId, pin);
            } else {
                await loadPasswordDetailsWithPin(currentPasswordId, pin);
            }
        } else if (currentAction === 'copy') {
            if (isSharedPassword) {
                await copySharedPasswordWithPin(currentPasswordId, pin);
            } else if (isFamilyVaultPassword) {
                await copyFamilyVaultPasswordWithPin(currentPasswordId, pin);
            } else {
                await copyPasswordWithPin(currentPasswordId, pin);
            }
        } else if (currentAction === 'share_final') {
            await completePasswordSharingWithPin(pin);
        } else if (currentAction === 'share_qr') {
            await completeQrCodeGeneration(pin);
        } else if (currentAction === 'share_family_vault') {
            await completeFamilyVaultSharingWithPin(pin);
        } else if (currentAction === 'add_family_vault') {
            await completeFamilyVaultAddWithPin(pin);
        } else if (currentAction === 'cancel_subscription') {
            await processSubscriptionCancellation(pin);
        } else if (currentAction === 'save_edit') {
            await executeUpdatePassword(pin);
        }


        closeModal('pinModal');

        // Clear pending actions
        if (currentAction === 'cancel_subscription') {
            window.pendingCancellationPlan = null;
        }
        if (currentAction === 'share_family_vault') {
            window.pendingFamilyShare = null;
        }
        if (currentAction === 'add_family_vault') {
            window.pendingFamilyAdd = null;
        }

        }  catch (error) {
            // === ERROR HANDLING LOGIC ===
            showNotification('Invalid PIN or error: ' + error.message, 'error');
            
            // If we were trying to save an edit and failed, re-open the edit screen
            if (currentAction === 'save_edit') {
                closeModal('pinModal');
                showModal('passwordDetailsModal'); 
            } else {
                // Otherwise just reset inputs for another try
                setupPinInputs(); 
            }
        }
}

function updatePlanUI(planName) {

    const upgradeCard = document.getElementById('sidebarUpgradeCard');
    if (upgradeCard) {
        if (planName !== 'free') {
            upgradeCard.innerHTML = `
                <div class="upgrade-icon upgrade-icon-success">
                    <i class="fas fa-crown"></i>
                </div>
                <div class="upgrade-title">${planName.charAt(0).toUpperCase() + planName.slice(1)} Plan</div>
                <div class="upgrade-description">You're on the ${planName} plan. Enjoy premium features!</div>
                <button class="upgrade-btn-sidebar" data-action="showDashboardView" data-arg="subscription">
                    Manage Subscription
                </button>
            `;
        } else {
            upgradeCard.innerHTML = `
                <div class="upgrade-icon">
                    <i class="fas fa-crown"></i>
                </div>
                <div class="upgrade-title">Upgrade to Premium</div>
                <div class="upgrade-description">Unlock advanced security features and sharing capabilities</div>
                <button class="upgrade-btn-sidebar" data-action="showDashboardView" data-arg="subscription">
                    Upgrade Now
                </button>
            `;
        }
    }

    // Update subscription view
    updateSubscriptionView(planName);
}

// Auth Functions
async function register() {
    const name = document.getElementById('registerName').value;
    const email = document.getElementById('registerEmail').value;
    const password = document.getElementById('registerPassword').value;
    const pin = document.getElementById('registerPin').value;

    if (!name || !email || !password || !pin) {
        showAlert('registerAlert', 'Please fill in all fields');
        return;
    }

    if (password.length < 8) {
        showAlert('registerAlert', 'Password must be at least 8 characters long.');
        return;
    }

    if (pin.length !== 4) {
        showAlert('registerAlert', 'PIN must be 4 digits');
        return;
    }

    const btn = document.querySelector('button[data-action="register"]');
    const originalContent = btn.innerHTML;
    

    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin" style="font-size: 1.2rem;"></i>';
    btn.disabled = true;

    try {
        // --- ZKA LOGIC ---

        const kdfSalt = generateSalt();

        const masterKeyBuffer = await deriveMasterKey(password, kdfSalt);

        const authKeyHex = await deriveAuthKey(masterKeyBuffer);

        const keyPair = await generateKeyPair();
        
        const publicKeyJSON = await exportKeyAsJSON(keyPair.publicKey);
        
        const privateKeyJSON = await exportKeyAsJSON(keyPair.privateKey);
        
        const encryptedPrivateKey = await encryptData(privateKeyJSON, masterKeyBuffer);

        // --- API CALL ---
        const result = await apiCall('/api/auth/register', {
            method: 'POST',
            body: JSON.stringify({ 
                name, 
                email, 
                password: authKeyHex, 
                pin,
                kdfSalt, 
                publicKey: publicKeyJSON, 
                encryptedPrivateKey: encryptedPrivateKey
            })
        });

        currentUser = { email, name, plan: 'free' };
        showAlert('registerAlert', 'Registration successful! Check your email for verification code.', 'success');
        showAuthScreen('verifyScreen');
        
    } catch (error) {
        showAlert('registerAlert', error.message);
    } finally {
        btn.innerHTML = originalContent;
        btn.disabled = false;
    }
}

// --- UPDATED LOGIN FUNCTION ---

async function login() {
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;

    if (!email || !password) {
        showAlert('loginAlert', 'Please fill in all fields');
        return;
    }

    const btn = document.querySelector('button[data-action="login"]');
    const originalContent = btn.innerHTML; 
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i>';
    btn.disabled = true;

    try {
        let saltData;
        try {
            const saltRes = await fetch(`${API_BASE}/api/auth/salt?email=${encodeURIComponent(email)}`);
            saltData = await saltRes.json();
        } catch (e) {
            throw new Error("Could not connect to server");
        }

        if (!saltData || !saltData.salt) throw new Error("Invalid credentials");

        const masterKeyBuffer = await deriveMasterKey(password, saltData.salt);
        sessionMasterKey = masterKeyBuffer; 
        await saveKeyToSession(masterKeyBuffer);
        const authKeyHex = await deriveAuthKey(masterKeyBuffer);


        const result = await apiCall('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ 
                email, 
                password: authKeyHex 
            })
        });

        if (result.needsVerification) {
            showAlert('loginAlert', 'Please verify your email first');
            showAuthScreen('verifyScreen');
            return;
        }

        if (result.user.encrypted_private_key) {
            try {

                const privateKeyJSON = await decryptData(result.user.encrypted_private_key, masterKeyBuffer);
                

                sessionPrivateKey = await importKeyFromJSON(privateKeyJSON, "private");
                console.log("PKI: Private Key restored successfully.");
                localStorage.setItem('ep_enc_private_key', result.user.encrypted_private_key);
                
            } catch (e) {
                console.error("Failed to restore Private Key:", e);
            }
        }

        allPasswords = [];
        authToken = result.authToken;
        currentUser = result.user;
        sessionStorage.setItem('ep_enc_private_key', result.user.encrypted_private_key);
        localStorage.setItem('kdfSalt', result.user.kdfSalt);

        showDashboard();
        
    } catch (error) {
        showAlert('loginAlert', error.message);
    } finally {
        // --- RESTORE BUTTON ---
        btn.innerHTML = originalContent;
        btn.disabled = false;
    }
}

async function showDashboard() {
    console.log('=== showDashboard started ===');
    
    try {

        document.getElementById('authContainer').style.display = 'none';
        document.getElementById('dashboardContainer').style.display = 'block';
        
        // Hide all views first
        Object.values(dashboardViews).forEach(view => {
            if (view) {
                view.classList.add('hidden');
                view.style.display = 'none';
            }
        });

        const dashboardView = document.getElementById('dashboardView');
        if (dashboardView) {
            dashboardView.classList.remove('hidden');
            dashboardView.style.display = 'block';
        }
        
        document.getElementById('userName').textContent = currentUser.name;
        document.getElementById('userAvatar').src = `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUser.name)}&background=4361ee&color=fff`;
        
        allPasswords = [];
        
        try {
            const currentPlan = await getUserPlan();
            currentUser.plan = currentPlan;
            updatePlanUI(currentPlan);
        } catch (error) {
            console.error('Error fetching user plan:', error);
            updatePlanUI(currentUser.plan || 'free');
        }
        
        localStorage.setItem('authToken', authToken);
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
        
        console.log('Dashboard setup complete, loading data...');
        
        loadDashboardData();
        
        await loadAndUpdatePasswords();
        
        console.log('=== showDashboard completed ===');
        
    } catch (error) {
        console.error('Error in showDashboard:', error);
        if (error.message.includes('auth') || error.message.includes('401') || error.message.includes('token')) {
            logout();
        }
    }
}

function checkPasswordStrength(password) {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++; 
  if (/[a-z]/.test(password)) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  
  return { score };
}

async function verifyEmail() {
    const email = currentUser.email;
    const code = document.getElementById('verifyCode').value;

    if (!code) {
        showAlert('verifyAlert', 'Please enter verification code');
        return;
    }

    try {
        await apiCall('/api/auth/verify-email', {
            method: 'POST',
            body: JSON.stringify({ email, code })
        });

        showAlert('verifyAlert', 'Email verified successfully! You can now login.', 'success');
        setTimeout(() => {
            showAuthScreen('loginScreen');
        }, 2000);
    } catch (error) {
        showAlert('verifyAlert', error.message);
    }
}

async function resendCode() {
    const email = currentUser.email;

    try {
        await apiCall('/api/auth/resend-code', {
            method: 'POST',
            body: JSON.stringify({ email })
        });

        showAlert('verifyAlert', 'Verification code resent to your email', 'success');
    } catch (error) {
        showAlert('verifyAlert', error.message);
    }
}

// Forgot Password Functions
function showForgotPassword() {
    showAuthScreen('forgotPasswordScreen');
}

async function sendResetLink() {
    const email = document.getElementById('forgotPasswordEmail').value;
    if (!email) {
        showAlert('forgotPasswordAlert', 'Please enter your email');
        return;
    }

    try {
        const result = await apiCall('/api/auth/forgot-password', {
            method: 'POST',
            body: JSON.stringify({ email })
        });

        showAlert('forgotPasswordAlert', result.message, 'success');
        
    } catch (error) {
        showAlert('forgotPasswordAlert', error.message);
    }
}

//Change Email Modal Functions

function showChangeEmailModal() {

    document.getElementById('newEmail').value = '';
    document.getElementById('changeEmailPassword').value = '';
    document.getElementById('changeEmailCode').value = '';
    

    const alertBox = document.getElementById('changeEmailAlert');
    if (alertBox) {
        alertBox.style.display = 'none';
        alertBox.textContent = '';
    }


    const step1 = document.getElementById('changeEmailStep1');
    const step2 = document.getElementById('changeEmailStep2');
    
    step1.classList.remove('hidden');
    step1.style.display = 'block';
    
    step2.classList.add('hidden');
    step2.style.display = 'none';


    const btn1 = document.getElementById('changeEmailStep1Btn');
    const btn2 = document.getElementById('changeEmailStep2Btn');
    
    btn1.classList.remove('hidden');
    btn1.style.display = 'block';
    btn1.textContent = 'Request Change'; 
    btn1.disabled = false;
    
    btn2.classList.add('hidden');
    btn2.style.display = 'none';
    
    showModal('changeEmailModal');
}

async function requestEmailChange() {
    const newEmail = document.getElementById('newEmail').value;
    const password = document.getElementById('changeEmailPassword').value;

    if (!newEmail || !password) {
        showAlert('changeEmailAlert', 'Please fill in all fields');
        return;
    }

    const btn = document.getElementById('changeEmailStep1Btn');
    const originalText = btn.textContent;
    btn.textContent = "Verifying...";
    btn.disabled = true;

    try {
        const authKey = await getAuthKeyForPassword(currentUser.email, password);

        const result = await apiCall('/api/auth/change-email', {
            method: 'POST',
            body: JSON.stringify({ 
                newEmail, 
                password: authKey // Send Hash
            })
        });

        showAlert('changeEmailAlert', result.message, 'success');


        document.getElementById('newEmailDisplay').textContent = newEmail;

        const step1 = document.getElementById('changeEmailStep1');
        const step2 = document.getElementById('changeEmailStep2');
        const btn1 = document.getElementById('changeEmailStep1Btn');
        const btn2 = document.getElementById('changeEmailStep2Btn');


        step1.classList.add('hidden');
        step1.style.display = 'none'; 
        btn1.classList.add('hidden');
        btn1.style.display = 'none';  

        // Show Step 2
        step2.classList.remove('hidden');
        step2.style.display = 'block'; 
        btn2.classList.remove('hidden');
        btn2.style.display = 'block';

    } catch (error) {
        let msg = error.message;
        if (msg.includes('401')) msg = 'Incorrect password.';
        showAlert('changeEmailAlert', msg);
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

async function verifyEmailChange() {
    const newEmail = document.getElementById('newEmail').value; 
    const code = document.getElementById('changeEmailCode').value;

    if (!code) {
        showAlert('changeEmailAlert', 'Please enter the verification code');
        return;
    }

    try {
        const result = await apiCall('/api/auth/verify-email-change', {
            method: 'POST',
            body: JSON.stringify({ newEmail, code })
        });

        showAlert('changeEmailAlert', result.message, 'success');
        
        document.getElementById('changeEmailStep2Btn').style.display = 'none';
        
        setTimeout(() => {
            closeModal('changeEmailModal');
            logout(true);
        }, 3000);

    } catch (error) {
        showAlert('changeEmailAlert', error.message);
    }
}


async function resetPassword() {
    const newPassword = document.getElementById('resetPassword').value;
    const confirmPassword = document.getElementById('resetPasswordConfirm').value;
    
    // The token from the URL
    const token = window.passwordResetToken;

    if (!token) {
        showAlert('resetPasswordAlert', 'Invalid or missing reset token.');
        return;
    }

    if (!newPassword || !confirmPassword) {
        showAlert('resetPasswordAlert', 'Please fill in all fields');
        return;
    }

    if (newPassword.length < 8) {
        showAlert('resetPasswordAlert', 'Password must be at least 8 characters long.');
        return;
    }

    if (newPassword !== confirmPassword) {
        showAlert('resetPasswordAlert', 'Passwords do not match');
        return;
    }

    const btn = document.querySelector('button[data-action="resetPassword"]');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Securing...';
    btn.disabled = true;

    try {

        const kdfSalt = generateSalt();

        const masterKeyBuffer = await deriveMasterKey(newPassword, kdfSalt);

        const authKeyHex = await deriveAuthKey(masterKeyBuffer);


        const result = await apiCall('/api/auth/reset-password', {
            method: 'POST',
            body: JSON.stringify({ 
                token, 
                newPassword: authKeyHex, 
                kdfSalt: kdfSalt         
            })
        });

        showAlert('resetPasswordAlert', 'Password reset successfully! You can now log in.', 'success');
        
        window.passwordResetToken = null;
        history.pushState({}, document.title, window.location.pathname);
        
        setTimeout(() => {
            showAuthScreen('loginScreen');
        }, 3000);

    } catch (error) {
        showAlert('resetPasswordAlert', error.message);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}


async function logout(closeTab = false) {
    try {
        if (authToken) {

        await apiCall('/api/auth/logout', {
            method: 'POST'
        });
        }
    } catch (error) {
        console.error('Server-side logout failed, proceeding with client-side cleanup:', error);
    } finally {
        currentUser = null;
        authToken = null;
        sessionMasterKey = null;


        localStorage.removeItem('authToken');
        localStorage.removeItem('currentUser');
        localStorage.removeItem('ep_session_key');
        localStorage.removeItem('ep_enc_private_key');
        
        if (closeTab) {
            window.close();
            window.location.href = '/'; 
        } else {
            window.location.href = '/';
        }
    }
}

// Dashboard Functions
async function loadDashboardData() {
    try {
        const result = await apiCall('/api/dashboard/stats');
        const stats = result.stats;

        document.getElementById('totalPasswords').textContent = stats.total;
        document.getElementById('weakPasswords').textContent = stats.weak;
        document.getElementById('totalCategories').textContent = stats.categories;
        
        const securityScore = stats.total > 0 ? Math.round(((stats.total - stats.weak) / stats.total) * 100) : 100;
        document.getElementById('securityScore').textContent = securityScore + '%';
        document.getElementById('securityStatus').textContent = 
            securityScore >= 80 ? 'Excellent' : 
            securityScore >= 60 ? 'Good' : 'Needs Improvement';

    } catch (error) {
        console.error('Error loading dashboard data:', error);
    }
}


function createPasswordItem(password) {
    const item = document.createElement('div');
    item.className = 'password-item';
    
    const strengthClass = password.strength_score >= 4 ? 'strong' : 
                            password.strength_score >= 2 ? 'medium' : 'weak';

    const shareButton = (currentUser.plan === 'premium' || currentUser.plan === 'family') ? 
        `<button class="action-btn share-password" data-id="${password.id}" title="Share Password">
            <i class="fas fa-share-alt"></i>
        </button>` : '';

    const shareToVaultButton = (currentUser.plan === 'family') ? 
        `<button class="action-btn share-to-vault" data-id="${password.id}" title="Share to Family Vault">
            <i class="fas fa-home"></i>
        </button>` : '';

    item.innerHTML = `
        <div class="password-icon">${password.website.charAt(0).toUpperCase()}</div>
        <div class="password-details">
            <div class="password-name">${password.website}</div>
            <div class="password-username">${password.username}</div>
        </div>
        <div class="password-actions">
            ${shareToVaultButton}
            ${shareButton}
            <button class="action-btn view-password" data-id="${password.id}">
                <i class="fas fa-eye"></i>
            </button>
            <button class="action-btn copy-password" data-id="${password.id}">
                <i class="fas fa-copy"></i>
            </button>
            <button class="action-btn delete-password" data-id="${password.id}">
                <i class="fas fa-trash"></i>
            </button>
        </div>
    `;

    // Add event listeners
    item.querySelector('.view-password').addEventListener('click', function(e) {
        e.stopPropagation();
        showPasswordDetails(password.id);
    });

    item.querySelector('.copy-password').addEventListener('click', function(e) {
        e.stopPropagation();
        copyPasswordToClipboard(password.id);
    });

    item.querySelector('.delete-password').addEventListener('click', function(e) {
        e.stopPropagation();
        deletePassword(password.id);
    });

    const shareBtn = item.querySelector('.share-password');
    if (shareBtn) {
        shareBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            showSharePasswordModal(password.id);
        });
    }

    const shareToVaultBtn = item.querySelector('.share-to-vault');
    if (shareToVaultBtn) {
        shareToVaultBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            showShareToFamilyVaultModal(password.id);
        });
    }

    return item;
}


async function resyncShares(passwordId, plainDataObj) {
    try {
        const res = await apiCall(`/api/passwords/${passwordId}/shares`, { method: 'GET' });
        const shares = res.shares || [];

        if (shares.length === 0) return; 

        console.log(`Syncing update to ${shares.length} recipients...`);
        showNotification(`Syncing update to ${shares.length} shared users...`, 'info');

        const payloadString = JSON.stringify(plainDataObj);

        await Promise.all(shares.map(async (share) => {
            try {
                const recipientPublicKey = await importKeyFromJSON(share.public_key, "public");
                const ephemeralKey = await generateEphemeralKey();
                const rawEphemeralKey = await exportRawKey(ephemeralKey);
                const encryptedPayload = await encryptData(payloadString, rawEphemeralKey);
                const encryptedKey = await encryptRSA(rawEphemeralKey, recipientPublicKey);

                await apiCall(`/api/shared-passwords/${share.id}`, {
                    method: 'PUT',
                    body: JSON.stringify({
                        encryptedPayload,
                        encryptedKey
                    })
                });
            } catch (err) {
                console.error(`Failed to sync share ${share.id}`, err);
            }
        }));

        console.log("Sync complete.");

    } catch (error) {
        console.error("Resync failed:", error);
    }
}

async function loadAndUpdatePasswords() {
    console.log('Fetching and decrypting vault...');
    
    const loadingRecent = document.getElementById('recentPasswordsLoading');
    const loadingAll = document.getElementById('allPasswordsLoading');
    if (loadingRecent) loadingRecent.style.display = 'block';
    if (loadingAll) loadingAll.style.display = 'block';

    try {
        const result = await apiCall('/api/passwords');
        const rawPasswords = result.passwords || [];

        if (!sessionMasterKey) {
            console.warn("Encryption key missing. UI will show encrypted blobs.");
        }

        const decryptedList = await Promise.all(rawPasswords.map(async (p) => {
            try {
                // If key is missing, return raw (safeguard)
                if (!sessionMasterKey) return p;
                
                // Decrypt the username so the list looks nice this took so long to implement :(
                const plainUser = await decryptData(p.username, sessionMasterKey);
                return { ...p, username: plainUser };
            } catch (e) {
                return { ...p, username: "Error decrypting" };
            }
        }));

        allPasswords = decryptedList;

        updatePasswordLists();

    } catch (error) {
        console.error('Error loading passwords:', error);
    } finally {
        if (loadingRecent) loadingRecent.style.display = 'none';
        if (loadingAll) loadingAll.style.display = 'none';
    }
}

function updatePasswordLists() {
    const recentList = document.getElementById('recentPasswordsList');
    if (recentList) {
        recentList.innerHTML = '';
        const recentPasswords = allPasswords.slice(0, 5);
        
        if (recentPasswords.length === 0) {
            recentList.innerHTML = `<div class="empty-state"><i class="fas fa-key"></i><h3>No passwords yet</h3><p>Add your first password to get started</p></div>`;
        } else {
            recentPasswords.forEach(p => recentList.appendChild(createPasswordItem(p)));
        }
    }

    const allList = document.getElementById('allPasswordsList');
    if (allList) {
        const selectedText = document.getElementById('selectedCategoryText');
        if (selectedText) selectedText.textContent = 'All Categories';
        document.querySelectorAll('.dropdown-option').forEach(opt => opt.classList.remove('selected'));
        const allOption = document.querySelector('.dropdown-option[data-value="all"]');
        if (allOption) allOption.classList.add('selected');

        allList.innerHTML = '';

        if (allPasswords.length === 0) {
            allList.innerHTML = `<div class="empty-state"><i class="fas fa-key"></i><h3>No passwords yet</h3><p>Add your first password to get started</p></div>`;
        } else {
            allPasswords.forEach(p => allList.appendChild(createPasswordItem(p)));
        }
    }
}

function sortPasswordsByCategory(selectedCategory) {
    const passwordListContainer = document.getElementById('allPasswordsList');
    passwordListContainer.innerHTML = '';

    let filteredPasswords = (selectedCategory === 'all')
        ? allPasswords
        : allPasswords.filter(p => p.category === selectedCategory);

    if (filteredPasswords.length === 0) {
        const emptyStateMessage = selectedCategory === 'all' 
            ? `<div class="empty-state">...</div>`
            : `<div class="empty-state">
                   <i class="fas fa-folder-open"></i>
                   <h3>No Passwords Found</h3>
                   <p>You don't have any passwords in the "${selectedCategory}" category.</p>
               </div>`;
        passwordListContainer.innerHTML = emptyStateMessage;
    } else {
        filteredPasswords.forEach(password => {
            const item = createPasswordItem(password);
            passwordListContainer.appendChild(item);
        });
    }
}

function searchPasswords() {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    const currentView = document.querySelector('#dashboardView').style.display !== 'none' ? 'recentPasswordsList' : 'allPasswordsList';
    const list = document.getElementById(currentView);
    
    const items = list.querySelectorAll('.password-item');
    items.forEach(item => {
        const website = item.querySelector('.password-name').textContent.toLowerCase();
        const username = item.querySelector('.password-username').textContent.toLowerCase();
        
        if (website.includes(searchTerm) || username.includes(searchTerm)) {
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
    });
}


function showAddPasswordModal() {
    document.getElementById('passwordWebsite').value = '';
    document.getElementById('passwordUsername').value = '';
    document.getElementById('passwordValue').value = '';
    document.getElementById('passwordCategory').value = 'Personal';
    document.getElementById('passwordUrl').value = '';
    document.getElementById('passwordNotes').value = '';
    document.getElementById('passwordStrength').className = 'security-strength';
    showModal('addPasswordModal');
}


document.getElementById('passwordValue').addEventListener('input', function() {
    const password = this.value;
    let strength = 0;
    
    if (password.length >= 8) strength += 1;
    if (password.length >= 12) strength += 1;
    if (/[a-z]/.test(password)) strength += 1;
    if (/[A-Z]/.test(password)) strength += 1;
    if (/[0-9]/.test(password)) strength += 1;
    if (/[^A-Za-z0-9]/.test(password)) strength += 1;
    
    const strengthBar = document.getElementById('passwordStrength');
    strengthBar.className = 'security-strength';
    
    if (strength <= 2) {
        strengthBar.classList.add('security-weak');
    } else if (strength <= 4) {
        strengthBar.classList.add('security-medium');
    } else {
        strengthBar.classList.add('security-strong');
    }
});

async function addPassword() {
    const website = document.getElementById('passwordWebsite').value;
    const username = document.getElementById('passwordUsername').value;
    const password = document.getElementById('passwordValue').value;
    const category = document.getElementById('passwordCategory').value;
    const url = document.getElementById('passwordUrl').value;
    const notes = document.getElementById('passwordNotes').value;
    const strengthData = checkPasswordStrength(password);

    if (!website || !username || !password) {
        showNotification('Please fill in all required fields', 'error');
        return;
    }

    try {
        if (!sessionMasterKey) throw new Error("Session key missing. Please log in again.");

        const encUsername = await encryptData(username, sessionMasterKey);
        const encPassword = await encryptData(password, sessionMasterKey);
        const encUrl = await encryptData(url || '', sessionMasterKey);
        const encNotes = await encryptData(notes || '', sessionMasterKey);

        await apiCall('/api/passwords', {
            method: 'POST',
            body: JSON.stringify({
                website,
                username: encUsername, 
                password: encPassword, 
                category,
                url: encUrl,           
                notes: encNotes,       
                strengthScore: strengthData.score
            })
        });

        closeModal('addPasswordModal');
        
        // Clear form
        document.getElementById('passwordWebsite').value = '';
        document.getElementById('passwordUsername').value = '';
        document.getElementById('passwordValue').value = '';
        document.getElementById('passwordUrl').value = '';
        document.getElementById('passwordNotes').value = '';
        
        await loadAndUpdatePasswords();
        showNotification('Password encrypted & saved successfully!');
        
    } catch (error) {
        showNotification('Error adding password: ' + error.message, 'error');
    }
}

async function showPasswordDetails(passwordId, isShared = false) {
    currentPasswordId = passwordId;
    currentAction = 'view';
    isSharedPassword = isShared;
    isFamilyVaultPassword = false;
    
    // Reset PIN modal to default view
    document.getElementById('pinModalTitle').textContent = 'Enter PIN to View Password';
    document.getElementById('pinModalDescription').textContent = 'For security reasons, please enter your PIN to view this password.';
    setupPinInputs();
    showModal('pinModal');
}


async function loadSharedPasswordDetails(shareId, pin) {
    try {
        const result = await apiCall(`/api/shared-passwords/${shareId}/view`, {
            method: 'POST', 
            body: JSON.stringify({ pin }) 
        });

        const share = result.share;

        if (!sessionPrivateKey) throw new Error("Private Key missing. Please re-login.");

        const rawAesKey = await decryptRSA(share.encryptedKey, sessionPrivateKey);

        const payloadString = await decryptData(share.encryptedPayload, rawAesKey);
        
        const data = JSON.parse(payloadString);

        cancelEditMode(); 


        document.getElementById('passwordDetailsTitle').textContent = data.website;
        document.getElementById('detailWebsite').value = data.website;
        document.getElementById('detailUsername').value = data.username;
        document.getElementById('detailPassword').value = data.password;
        document.getElementById('detailCategory').value = data.category || 'Personal';
        document.getElementById('detailUrl').value = data.url || '';
        document.getElementById('detailNotes').value = data.notes || '';

        // 5. Handle Shared Info & HIDE Edit Button (Forcefully)
        document.getElementById('sharedPasswordInfo').style.display = 'block';
        document.getElementById('detailSharedBy').value = share.sharedBy;
        
        const editBtn = document.getElementById('btnEditPassword');
        if (editBtn) {
            editBtn.classList.add('hidden');
            editBtn.style.display = 'none'; // Inline style override to be absolutely sure
        }

        showModal('passwordDetailsModal');

    } catch (error) {
        showNotification("Decryption failed: " + error.message, 'error');
    }
}

async function copySharedPasswordWithPin(shareId, pin) {
    try {
const result = await apiCall(`/api/shared-passwords/${shareId}/view`, {
    method: 'POST',
    body: JSON.stringify({ pin })
});

const share = result.share;

if (!sessionPrivateKey) throw new Error("Private Key missing.");

const rawAesKey = await decryptRSA(share.encryptedKey, sessionPrivateKey);

const payloadString = await decryptData(share.encryptedPayload, rawAesKey);
const data = JSON.parse(payloadString);

await navigator.clipboard.writeText(data.password);


setTimeout(async () => {
    try {
        await navigator.clipboard.writeText('');
    } catch (e) {
        // Ignore clipboard clearing errors
    }
}, 30000);

showNotification('Password copied to clipboard! It will be cleared in 30 seconds.');
    } catch (error) {
throw error;
    }
}

function setupPinInputs() {
    const inputs = document.querySelectorAll('#pinModal .pin-input');
    inputs.forEach((input, index) => {
        input.value = '';
        input.addEventListener('input', (e) => {
            if (e.target.value && index < inputs.length - 1) {
                inputs[index + 1].focus();
            }
        });
        
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && !e.target.value && index > 0) {
                inputs[index - 1].focus();
            }
        });
    });
    inputs[0].focus();
}

async function loadPasswordDetailsWithPin(passwordId, pin) {
    try {
        let result;
        if (isSharedPassword) {
             result = await apiCall(`/api/shared-passwords/${passwordId}/view`, {
                method: 'POST',
                body: JSON.stringify({ pin }) 
            });
        } else {
             result = await apiCall(`/api/passwords/${passwordId}/view`, {
                method: 'POST',
                body: JSON.stringify({ pin })
            });
        }

        const passwordData = result.password;

        if (!sessionMasterKey) throw new Error("Session key missing. Please log in again.");

        const plainUsername = await decryptData(passwordData.username, sessionMasterKey);
        const plainPassword = await decryptData(passwordData.password, sessionMasterKey);
        const plainUrl = await decryptData(passwordData.url, sessionMasterKey);
        const plainNotes = await decryptData(passwordData.notes, sessionMasterKey);

        document.getElementById('passwordDetailsTitle').textContent = passwordData.website;
        document.getElementById('detailWebsite').value = passwordData.website;
        document.getElementById('detailUsername').value = plainUsername; 
        document.getElementById('detailPassword').value = plainPassword; 
        document.getElementById('detailCategory').value = passwordData.category;
        document.getElementById('detailUrl').value = plainUrl;
        document.getElementById('detailNotes').value = plainNotes;

        if (passwordData.is_shared || passwordData.shared_by) {
            document.getElementById('sharedPasswordInfo').style.display = 'block';
            document.getElementById('detailSharedBy').value = passwordData.shared_by || 'Unknown';
            document.getElementById('btnEditPassword').classList.add('hidden');
        } else {
            document.getElementById('sharedPasswordInfo').style.display = 'none';
            document.getElementById('btnEditPassword').classList.remove('hidden');
        }

        cancelEditMode();
        showModal('passwordDetailsModal');
    } catch (error) {
        showNotification('Decryption failed: ' + error.message, 'error');
    }
}

function copyPassword() {
    const passwordField = document.getElementById('detailPassword');
    passwordField.select();
    document.execCommand('copy');
    showNotification('Password copied to clipboard!');
}

async function copyPasswordToClipboard(passwordId, isShared = false) {
    currentPasswordId = passwordId;
    currentAction = 'copy';
    isSharedPassword = isShared;
    isFamilyVaultPassword = false;
    

    document.getElementById('pinModalTitle').textContent = 'Enter PIN to Copy Password';
    document.getElementById('pinModalDescription').textContent = 'For security reasons, please enter your PIN to copy this password.';
    setupPinInputs();
    showModal('pinModal');
}

async function copyPasswordWithPin(passwordId, pin) {
    try {
        let result;
        
        if (isSharedPassword) {
            result = await apiCall(`/api/shared-passwords/${passwordId}/view`, {
                method: 'POST',
                body: JSON.stringify({ pin })
            });
        } else {
            result = await apiCall(`/api/passwords/${passwordId}/view`, {
                method: 'POST',
                body: JSON.stringify({ pin })
            });
        }

        if (!sessionMasterKey) throw new Error("Session key missing.");
        
        const plainPassword = await decryptData(result.password.password, sessionMasterKey);
        
        await navigator.clipboard.writeText(plainPassword);
        
        setTimeout(async () => {
            try {
                await navigator.clipboard.writeText('');
            } catch (e) {
                // Ignore clipboard clearing errors
            }
        }, 30000);
        
        showNotification('Password copied to clipboard! It will be cleared in 30 seconds.');
    } catch (error) {
        throw error;
    }
}

async function deletePassword(passwordId) {
    if (!confirm('Are you sure you want to delete this password? This action cannot be undone.')) {
        return;
    }

    try {
        await apiCall(`/api/passwords/${passwordId}`, {
            method: 'DELETE'
        });

        await loadAndUpdatePasswords();
        
        showNotification('Password deleted successfully!');
        
    } catch (error) {
        showNotification('Error deleting password: ' + error.message, 'error');
    }
}

function showAddFamilyVaultModal() {
    document.getElementById('familyVaultWebsite').value = '';
    document.getElementById('familyVaultUsername').value = '';
    document.getElementById('familyVaultPassword').value = '';
    document.getElementById('familyVaultShareWith').value = 'all';
    document.getElementById('familyVaultCategory').value = 'Entertainment';
    document.getElementById('familyVaultUrl').value = '';
    document.getElementById('familyVaultNotes').value = '';
    document.getElementById('familyVaultPasswordStrength').className = 'security-strength';
    

    loadFamilyMembersForSharing('add');
    showModal('addFamilyVaultModal');
}

function showShareToFamilyVaultModal(passwordId) {
    currentPasswordForSharing = passwordId;
    document.getElementById('shareToFamilyVaultWith').value = 'all';
    
    loadFamilyMembersForSharing('share');
    showModal('shareToFamilyVaultModal');
}

async function loadFamilyMembersForSharing(type = 'add') {
    try {
        const result = await apiCall('/api/family/vault/members');
        const members = result.members || [];
        const selectId = type === 'add' ? 'familyVaultSpecificMember' : 'shareToFamilyVaultSpecificMember';
        const groupId = type === 'add' ? 'specificMemberGroup' : 'shareSpecificMemberGroup';
        const toggleId = type === 'add' ? 'familyVaultShareWith' : 'shareToFamilyVaultWith';

        const selectElement = document.getElementById(selectId);
        const groupElement = document.getElementById(groupId);
        const toggleElement = document.getElementById(toggleId);

        if (!selectElement || !groupElement || !toggleElement) {
            console.error("Family sharing elements not found in DOM");
            return;
        }

        selectElement.innerHTML = '<option value="">Select a family member</option>';
        if (members.length === 0) {
            const option = document.createElement('option');
            option.text = "No other family members found";
            selectElement.appendChild(option);
        } else {
            members.forEach(member => {
                const option = document.createElement('option');
                option.value = member.id;
                option.textContent = `${member.name} (${member.role})`;
                selectElement.appendChild(option);
            });
        }

        toggleElement.onchange = function() {
            if (this.value === 'specific') {
                groupElement.classList.remove('hidden');
                groupElement.style.display = 'block'; 
            } else {
                groupElement.classList.add('hidden');
                groupElement.style.display = 'none';  
            }
        };
        
        toggleElement.onchange();

    } catch (error) {
        console.error('Error loading family members:', error);
    }
}

function shareToFamilyVault() {
    const shareWithMode = document.getElementById('shareToFamilyVaultWith').value; // 'all', 'parents', 'specific'
    const specificMemberId = document.getElementById('shareToFamilyVaultSpecificMember').value;

    if (!currentPasswordForSharing) {
        showNotification('No password selected for sharing', 'error');
        return;
    }

    let finalShareWith = shareWithMode;
    
    if (shareWithMode === 'specific') {
        if (!specificMemberId) {
            showNotification('Please select a family member', 'error');
            return;
        }
        finalShareWith = specificMemberId; 
    }

    closeModal('shareToFamilyVaultModal');
    
    document.getElementById('pinModalTitle').textContent = 'Enter PIN to Share to Family Vault';
    document.getElementById('pinModalDescription').textContent = 'Decrypting your password to share it securely...';
    
    currentAction = 'share_family_vault';
    setupPinInputs();
    showModal('pinModal');
    
    window.pendingFamilyShare = {
        passwordId: currentPasswordForSharing,
        shareWith: finalShareWith 
    };
}


async function addToFamilyVault() {
    const website = document.getElementById('familyVaultWebsite').value;
    const username = document.getElementById('familyVaultUsername').value;
    const password = document.getElementById('familyVaultPassword').value;
    const shareWith = document.getElementById('familyVaultShareWith').value;
    const specificMember = document.getElementById('familyVaultSpecificMember').value;
    const category = document.getElementById('familyVaultCategory').value;
    const url = document.getElementById('familyVaultUrl').value;
    const notes = document.getElementById('familyVaultNotes').value;

    if (!website || !username || !password) {
showNotification('Please fill in all required fields', 'error');
return;
    }

    const finalShareWith = shareWith === 'specific' ? specificMember : shareWith;

    if (shareWith === 'specific' && !specificMember) {
showNotification('Please select a family member', 'error');
return;
    }

    closeModal('addFamilyVaultModal');
    
    document.getElementById('pinModalTitle').textContent = 'Enter PIN to Add to Family Vault';
    document.getElementById('pinModalDescription').textContent = 'For security reasons, please enter your PIN to add this password to the family vault.';
    currentAction = 'add_family_vault';
    setupPinInputs();
    showModal('pinModal');
    
    window.pendingFamilyAdd = {
website,
username,
password,
shareWith: finalShareWith,
category,
url,
notes
    };
}


async function showFamilyVaultPasswordDetails(passwordId) {
    currentPasswordId = passwordId;
    currentAction = 'view';
    isFamilyVaultPassword = true;
    isSharedPassword = false;
    
    document.getElementById('pinModalTitle').textContent = 'Enter PIN to View Family Vault Password';
    document.getElementById('pinModalDescription').textContent = 'For security reasons, please enter your PIN to view this family vault password.';
    setupPinInputs();
    showModal('pinModal');
}

async function loadFamilyVaultPasswordDetails(passwordId, pin) {
    try {
        const result = await apiCall(`/api/family/vault/passwords/${passwordId}/view`, {
            method: 'POST',
            body: JSON.stringify({ pin })
        });

        const data = result.password;

        if (!sessionPrivateKey) throw new Error("Private Key missing.");

        const rawAesKey = await decryptRSA(data.encryptedKey, sessionPrivateKey);

        const payloadString = await decryptData(data.password, rawAesKey);
        const plainData = JSON.parse(payloadString);

        document.getElementById('passwordDetailsTitle').textContent = `${plainData.website} (Family)`;
        
        document.getElementById('detailWebsite').value = plainData.website;
        document.getElementById('detailUsername').value = plainData.username || ""; 
        document.getElementById('detailPassword').value = plainData.password || ""; 
        document.getElementById('detailCategory').value = plainData.category;
        document.getElementById('detailUrl').value = plainData.url || "";           
        document.getElementById('detailNotes').value = plainData.notes || "";       
        document.getElementById('btnEditPassword').classList.add('hidden');
        document.getElementById('sharedPasswordInfo').style.display = 'block';
        document.getElementById('detailSharedBy').value = `Added by: ${data.added_by_name}`;

        cancelEditMode();
        showModal('passwordDetailsModal');

    } catch (error) {
        console.error(error);
        showNotification("Access Denied or Decryption Failed", 'error');
    }
}
async function copyFamilyVaultPassword(passwordId) {
    currentPasswordId = passwordId;
    currentAction = 'copy';
    isFamilyVaultPassword = true;
    isSharedPassword = false;
    
    document.getElementById('pinModalTitle').textContent = 'Enter PIN to Copy Family Vault Password';
    document.getElementById('pinModalDescription').textContent = 'For security reasons, please enter your PIN to copy this family vault password.';
    setupPinInputs();
    showModal('pinModal');
}

async function copyFamilyVaultPasswordWithPin(passwordId, pin) {
    try {
        const result = await apiCall(`/api/family/vault/passwords/${passwordId}/view`, {
            method: 'POST',
            body: JSON.stringify({ pin })
        });
        
        const passwordText = result.password.password;
        
        await navigator.clipboard.writeText(passwordText);
        
        // Clear clipboard after 30 seconds for security
        setTimeout(async () => {
            try {
                await navigator.clipboard.writeText('');
            } catch (e) {
                // Ignore clipboard clearing errors
            }
        }, 30000);
        
        showNotification('Family vault password copied to clipboard! It will be cleared in 30 seconds.');
    } catch (error) {
        throw error;
    }
}

async function removeFromFamilyVault(passwordId) {
    if (!confirm('Are you sure you want to remove this password from the family vault?')) {
        return;
    }

    try {
        await apiCall(`/api/family/vault/passwords/${passwordId}`, {
            method: 'DELETE'
        });

        showNotification('Password removed from family vault successfully!');
        
        loadFamilySharingContent(currentUser.plan);
        
    } catch (error) {
        showNotification('Error removing from family vault: ' + error.message, 'error');
    }
}

function showSharePasswordModal(passwordId = null) {
    currentPasswordForSharing = passwordId;
    document.getElementById('shareEmail').value = '';
    document.getElementById('shareAccessLevel').value = 'view';
    document.getElementById('shareExpires').value = '';
    showModal('sharePasswordModal');
}

async function sharePassword() {
    const email = document.getElementById('shareEmail').value;
    const accessLevel = document.getElementById('shareAccessLevel').value;
    const expiresInHours = document.getElementById('shareExpires').value;

    if (!email) {
showNotification('Please enter recipient email', 'error');
return;
    }

    if (!currentPasswordForSharing) {
showNotification('No password selected for sharing', 'error');
return;
    }

    closeModal('sharePasswordModal');
    
    document.getElementById('pinModalTitle').textContent = 'Enter PIN to Share Password';
    document.getElementById('pinModalDescription').textContent = 'For security reasons, please enter your PIN to complete sharing.';
    currentAction = 'share_final';
    setupPinInputs();
    showModal('pinModal');
}

// Family sharing functions
function showCreateFamilyModal() {
    document.getElementById('familyName').value = 'My Family';
    showModal('createFamilyModal');
}

async function createFamilyGroup() {
    const name = document.getElementById('familyName').value;

    if (!name) {
        showNotification('Please enter a family group name', 'error');
        return;
    }

    try {
        await apiCall('/api/family/create', {
            method: 'POST',
            body: JSON.stringify({ name })
        });

        closeModal('createFamilyModal');
        showNotification('Family group created successfully');
        
        // Refresh the family sharing view
        loadFamilySharingContent(currentUser.plan);
        
    } catch (error) {
        showNotification('Error creating family group: ' + error.message, 'error');
    }
}

function showInviteFamilyModal() {
    document.getElementById('familyInviteEmail').value = '';
    document.getElementById('familyMemberRole').value = 'child';
    updateRolePermissions();
    showModal('inviteFamilyModal');
}


async function verifyPinForSharing(pin) {
    try {
const verifyResult = await apiCall('/api/auth/verify-pin', {
    method: 'POST',
    body: JSON.stringify({ pin })
});

if (!verifyResult.success) {
    throw new Error('Invalid PIN');
}

showSharePasswordForm();

    } catch (error) {
throw new Error('Failed to verify PIN for sharing');
    }
}
function showSharePasswordForm() {
    document.getElementById('shareEmail').value = '';
    document.getElementById('shareAccessLevel').value = 'view';
    document.getElementById('shareExpires').value = '';
    showModal('sharePasswordModal');
}

async function revokeShare(shareId) {
    if (!confirm('Are you sure you want to revoke this password share?')) {
        return;
    }

    try {
        await apiCall(`/api/shared-passwords/${shareId}`, {
            method: 'DELETE'
        });

        showNotification('Password share revoked successfully');
        
        loadSharingCenterContent(currentUser.plan);
        
    } catch (error) {
        showNotification('Error revoking share: ' + error.message, 'error');
    }
}
function updateRolePermissions() {
    const role = document.getElementById('familyMemberRole').value;
    const permissionsDiv = document.getElementById('rolePermissions');
    
    if (role === 'parent') {
        permissionsDiv.innerHTML = `
            <ul class="permissions-list">
                <li>Full access to all family passwords</li>
                <li>Can invite and manage family members</li>
                <li>Can enable emergency access</li>
            </ul>
        `;
    } else {
        permissionsDiv.innerHTML = `
            <ul class="permissions-list">
                <li>Access to passwords shared by parents</li>
                <li>Cannot invite new members</li>
                <li>Limited management capabilities</li>
            </ul>
        `;
    }
}

async function inviteFamilyMember() {
    const email = document.getElementById('familyInviteEmail').value;
    const role = document.getElementById('familyMemberRole').value;

    if (!email) {
        showNotification('Please enter family member email', 'error');
        return;
    }

    try {
        const result = await apiCall('/api/family/invite', {
            method: 'POST',
            body: JSON.stringify({ email, role })
        });

        closeModal('inviteFamilyModal');
        
        if (result.requiresSignup) {
            showNotification('Invitation sent! User will need to sign up for SecurePass first.');
        } else {
            showNotification('Family invitation sent successfully');
        }
        
    } catch (error) {
        showNotification('Error sending invitation: ' + error.message, 'error');
    }
}

async function removeFamilyMember(memberId) {
    if (!confirm('Are you sure you want to remove this family member?')) {
        return;
    }

    try {
        await apiCall(`/api/family/members/${memberId}`, {
            method: 'DELETE'
        });

        showNotification('Family member removed successfully');
        
        loadFamilySharingContent(currentUser.plan);
        
    } catch (error) {
        showNotification('Error removing family member: ' + error.message, 'error');
    }
}

async function enableEmergencyAccess() {
    if (!confirm('Enable emergency access? This will grant all family members access to shared passwords until disabled.')) {
        return;
    }

    try {
        await apiCall('/api/family/emergency-access/enable', {
            method: 'POST'
        });

        showNotification('Emergency access enabled successfully');
        
        loadFamilySharingContent(currentUser.plan);
        
    } catch (error) {
        showNotification('Error enabling emergency access: ' + error.message, 'error');
    }
}

async function disableEmergencyAccess() {
    if (!confirm('Disable emergency access?')) {
        return;
    }

    try {
        await apiCall('/api/family/emergency-access/disable', {
            method: 'POST'
        });

        showNotification('Emergency access disabled successfully');
        
        // Refresh the family sharing view
        loadFamilySharingContent(currentUser.plan);
        
    } catch (error) {
        showNotification('Error disabling emergency access: ' + error.message, 'error');
    }
}

// Family deletion functions
function showDeleteFamilyModal() {
    document.getElementById('deleteFamilyPassword').value = '';
    document.getElementById('deleteFamilyConfirmation').value = '';
    showModal('deleteFamilyModal');
}

async function deleteFamilyGroup() {
  const password = document.getElementById('deleteFamilyPassword').value;
  const confirmation = document.getElementById('deleteFamilyConfirmation').value;

  if (!password) {
    showNotification('Please enter your password', 'error');
    return;
  }

  if (confirmation !== 'DELETE FAMILY') {
    showNotification('Please type "DELETE FAMILY" to confirm', 'error');
    return;
  }

  if (!confirm('Are you absolutely sure? This will permanently delete your family group and remove all family members. Members will be restored to their previous plans. This action cannot be undone.')) {
    return;
  }

  try {
    // Show loading state
    const deleteBtn = document.querySelector('#deleteFamilyModal .btn-danger');
    const originalText = deleteBtn.textContent;
    deleteBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deleting...';
    deleteBtn.disabled = true;
    const authKey = await getAuthKeyForPassword(currentUser.email, password);

    // First verify the password by attempting to login
    await apiCall('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
email: currentUser.email,
password: authKey
      })
    });

    // Delete the family group
    await apiCall('/api/family', {
      method: 'DELETE'
    });

    // Reset button state
    deleteBtn.innerHTML = originalText;
    deleteBtn.disabled = false;

    closeModal('deleteFamilyModal');
    
    // Owner keeps family plan, no need to downgrade
    showNotification('Family group deleted successfully. Members have been restored to their previous plans.', 'success');
    
    // Refresh the family sharing view
    loadFamilySharingContent('family');
    
    // Update settings view
    updateSettingsView();
    
  } catch (error) {
    // Reset button state
    const deleteBtn = document.querySelector('#deleteFamilyModal .btn-danger');
    deleteBtn.textContent = 'Delete Family Group';
    deleteBtn.disabled = false;

    console.error('Delete family error details:', error);
    
    let userMessage = 'Error deleting family group: ';
    
    if (error.message.includes('JSON') || error.message.includes('Unexpected token')) {
      userMessage += 'Service temporarily unavailable. Please try again later.';
    } else if (error.message.includes('NetworkError') || error.message.includes('Failed to fetch')) {
      userMessage += 'Network error. Please check your connection and try again.';
    } else if (error.message.includes('401') || error.message.includes('unauthorized')) {
      userMessage += 'Invalid password. Please check your password and try again.';
    } else if (error.message.includes('403')) {
      userMessage += 'Only the family owner can delete the family group.';
    } else if (error.message.includes('404')) {
      userMessage += 'Family group not found or already deleted.';
    } else {
      userMessage += error.message;
    }
    
    showNotification(userMessage, 'error');
  }
}

// Account Deletion Functions
function showDeleteAccountModal() {
    document.getElementById('deleteAccountPassword').value = '';
    document.getElementById('deleteConfirmation').value = '';
    showModal('deleteAccountModal');
}

async function deleteAccount() {
    const password = document.getElementById('deleteAccountPassword').value;
    const confirmation = document.getElementById('deleteConfirmation').value;

    if (!password) {
        showNotification('Please enter your password', 'error');
        return;
    }

    if (confirmation !== 'DELETE') {
        showNotification('Please type "DELETE" to confirm', 'error');
        return;
    }

    if (!confirm('Are you absolutely sure? This will permanently delete your account and all your passwords. This action cannot be undone.')) {
        return;
    }

    try {
        // Show loading state
        const deleteBtn = document.querySelector('#deleteAccountModal .btn-danger');
        const originalText = deleteBtn.textContent;
        deleteBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deleting...';
        deleteBtn.disabled = true;
        const authKey = await getAuthKeyForPassword(currentUser.email, password);

        // First verify the password by attempting to login
        await apiCall('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({
                email: currentUser.email,
                password: authKey
            })
        });


        const result = await apiCall('/api/auth/delete-account', {
            method: 'DELETE'
        });

        deleteBtn.innerHTML = originalText;
        deleteBtn.disabled = false;

        closeModal('deleteAccountModal');
        showNotification('Account deleted successfully', 'success');
        
        // Logout and redirect to login
        setTimeout(() => {
            logout();
        }, 2000);
        
    } catch (error) {
        // Reset button state
        const deleteBtn = document.querySelector('#deleteAccountModal .btn-danger');
        deleteBtn.textContent = 'Delete Account';
        deleteBtn.disabled = false;

        console.error('Delete account error details:', error);
        
        // Enhanced error handling
        let userMessage = 'Error deleting account: ';
        
        if (error.message.includes('JSON') || error.message.includes('Unexpected token')) {
            userMessage += 'Service temporarily unavailable. Please try again later.';
        } else if (error.message.includes('NetworkError') || error.message.includes('Failed to fetch')) {
            userMessage += 'Network error. Please check your connection and try again.';
        } else if (error.message.includes('401') || error.message.includes('unauthorized')) {
            userMessage += 'Invalid password. Please check your password and try again.';
        } else if (error.message.includes('404')) {
            userMessage += 'Account not found or already deleted.';
        } else {
            userMessage += error.message;
        }
        
        showNotification(userMessage, 'error');
    }
}

async function completePasswordSharingWithPin(pin) {
    const email = document.getElementById('shareEmail').value;
    const accessLevel = document.getElementById('shareAccessLevel').value;
    const expiresInHours = document.getElementById('shareExpires').value;

    if (!currentPasswordForSharing) return;

    // Show loading state in the PIN modal button if possible, or just rely on notification later
    
    try {
        // 1. Get Recipient's Public Key
        const keyRes = await fetch(`${API_BASE}/api/users/public-key?email=${encodeURIComponent(email)}`);

         
        if (keyRes.status === 404) {
            
            if(!confirm(`User ${email} not registered.\n\nSend a secure code via email?`)) return;

            // A. Generate Crypto (Client Side)
            const inviteCode = generateInviteCode();
            const inviteKey = await deriveKeyFromInviteCode(inviteCode);
            const inviteRawKey = await exportInviteKey(inviteKey);
            const inviteCodeHash = await hashInviteCode(inviteCode);

            // B. Decrypt Item Locally (Unlock with Session Key)
            const item = allPasswords.find(p => p.id == currentPasswordForSharing);
            
            // Fetch full details from server
            const detailRes = await apiCall(`/api/passwords/${currentPasswordForSharing}/view`, {
                method: 'POST', body: JSON.stringify({ pin }) 
            });
            const plainPassword = await decryptData(detailRes.password.password, sessionMasterKey);
            const plainUrl = await decryptData(detailRes.password.url, sessionMasterKey);
            const plainNotes = await decryptData(detailRes.password.notes, sessionMasterKey);

            // C. Bundle & Encrypt with INVITE KEY
            const payloadObj = {
                website: item.website,
                username: item.username,
                password: plainPassword,
                url: plainUrl,
                notes: plainNotes,
                category: item.category // Ensure category is shared
            };
            const encryptedPayload = await encryptData(JSON.stringify(payloadObj), inviteRawKey);

            // D. CALL 1: STORAGE (Send Blob, NO CODE)
            console.log("Step 1: Uploading encrypted container...");
            const storageRes = await apiCall(`/api/passwords/${currentPasswordForSharing}/share`, {
                method: 'POST',
                headers: { 'X-PIN-Verification': pin },
                body: JSON.stringify({
                    email,
                    accessLevel,
                    expiresInHours: expiresInHours ? parseInt(expiresInHours) : null,
                    encryptedPayload, 
                    encryptedKey: "INVITE_MODE", 
                    inviteCodeHash
                })
            });

            console.log("Storage Response:", storageRes);

            if (storageRes.requiresNotification || storageRes.inviteCreated) {
                console.log("Step 2: Sending notification via separate channel...");
                await apiCall('/api/shares/notify', {
                    method: 'POST',
                    body: JSON.stringify({
                        email: email,
                        inviteCode: inviteCode 
                    })
                });
                console.log("Notification sent.");
            }

            closeModal('pinModal');
            showNotification(`Secure code sent to ${email}`, 'success');
            return;
        }

        if (!keyRes.ok) {
            const err = await keyRes.json();
            throw new Error(err.error || "User has no keys setup.");
        }
        const keyData = await keyRes.json();
        
        const recipientPublicKey = await importKeyFromJSON(keyData.publicKey, "public");


        const item = allPasswords.find(p => p.id == currentPasswordForSharing);
        if (!item) throw new Error("Password data not found in cache.");
        

        const detailRes = await apiCall(`/api/passwords/${currentPasswordForSharing}/view`, {
            method: 'POST',
            body: JSON.stringify({ pin }) 
        });
        
        if (!sessionMasterKey) throw new Error("Session key missing.");

        // Decrypt using OUR Master Key
        const plainPassword = await decryptData(detailRes.password.password, sessionMasterKey);
        const plainUrl = await decryptData(detailRes.password.url, sessionMasterKey);
        const plainNotes = await decryptData(detailRes.password.notes, sessionMasterKey);

        // 3. Bundle the data to share
        const payloadObj = {
            website: item.website,
            username: item.username, // Already plain in 'item' from list cache
            password: plainPassword,
            url: plainUrl,
            notes: plainNotes,
            category: item.category
        };
        const payloadString = JSON.stringify(payloadObj);

        // 4. Generate One-Time Key
        const ephemeralKey = await generateEphemeralKey();
        const rawEphemeralKey = await exportRawKey(ephemeralKey);

        // 5. Encrypt Payload with One-Time Key
        const encryptedPayload = await encryptData(payloadString, rawEphemeralKey);

        // 6. Encrypt One-Time Key with Recipient's Public Key
        const encryptedKey = await encryptRSA(rawEphemeralKey, recipientPublicKey);

        // 7. Send to Server (WITH HEADERS)
        const result = await apiCall(`/api/passwords/${currentPasswordForSharing}/share`, {
            method: 'POST',
            headers: { 
                'X-PIN-Verification': pin 
            },
            body: JSON.stringify({
                email,
                accessLevel,
                expiresInHours: expiresInHours ? parseInt(expiresInHours) : null,
                encryptedPayload,
                encryptedKey
            })
        });

        showNotification(result.message, 'success');
        closeModal('pinModal');
        loadSharingCenterContent(currentUser.plan);

    } catch (error) {
        console.error("Share Error:", error);
        showNotification('Share failed: ' + error.message, 'error');
    }
}
// ==================== QR Code Functions [NEW] ====================

function generateQrCodeForSharing() {
    closeModal('sharePasswordModal');
    document.getElementById('pinModalTitle').textContent = 'Enter PIN to Generate QR Code';
    document.getElementById('pinModalDescription').textContent = 'For security reasons, your PIN is required to create a shareable QR code.';
    currentAction = 'share_qr';
    setupPinInputs();
    showModal('pinModal');
}

async function completeQrCodeGeneration(pin) {
    try {
        const btn = document.querySelector('#pinModal .btn-primary');
        if(btn) { btn.innerText = "Generating..."; btn.disabled = true; }

        if (!currentPasswordForSharing) throw new Error("No password selected");

        // 1. Decrypt the Password locally using PIN auth to get blob
        const detailRes = await apiCall(`/api/passwords/${currentPasswordForSharing}/view`, {
            method: 'POST', body: JSON.stringify({ pin })
        });
        
        if (!sessionMasterKey) throw new Error("Session key missing");

        const plainPassword = await decryptData(detailRes.password.password, sessionMasterKey);
        const plainUrl = await decryptData(detailRes.password.url, sessionMasterKey);
        const plainNotes = await decryptData(detailRes.password.notes, sessionMasterKey);
        const item = allPasswords.find(p => p.id == currentPasswordForSharing);

        // 2. Prepare Payload
        const payloadObj = {
            website: item.website,
            username: item.username,
            password: plainPassword,
            url: plainUrl,
            notes: plainNotes,
            category: item.category
        };
        const payloadString = JSON.stringify(payloadObj);

        // 3. Generate QR Key (Random AES Key)
        // This key NEVER goes to the server. It only goes into the QR image.
        const qrKey = await generateEphemeralKey();
        const rawQrKey = await exportRawKey(qrKey);
        const qrKeyHex = buf2hex(rawQrKey); // Convert to hex string for QR

        // 4. Encrypt Payload with QR Key
        const encryptedPayload = await encryptData(payloadString, rawQrKey);

        // 5. Send Payload to Server (Server gives us a Token)
        const result = await apiCall(`/api/passwords/${currentPasswordForSharing}/share-qr`, {
            method: 'POST',
            headers: { 'X-PIN-Verification': pin },
            body: JSON.stringify({ encryptedPayload })
        });

        // 6. Generate QR: Contains Token AND the Secret Key
        const qrData = JSON.stringify({
            t: result.token,
            k: qrKeyHex
        });

        const qrContainer = document.getElementById('qrCodeContainer');
        qrContainer.innerHTML = '';

        const qr = qrcode(0, 'L');
        qr.addData(qrData); // We embed the Key here!
        qr.make();
        qrContainer.innerHTML = qr.createImgTag(6, 8);

        closeModal('pinModal');
        showModal('qrCodeModal');

    } catch (error) {
        showNotification(`Error generating QR code: ${error.message}`, 'error');
        if(btn) { btn.innerText = "Verify PIN"; btn.disabled = false; }
    }
}

function showQrScannerModal() {
    if (currentUser.plan === 'free') {
showNotification('Scanning QR codes requires a Premium plan.', 'error');
showDashboardView('subscription');
return;
    }

    showModal('qrScannerModal');
    startQrScanner();
}

function closeQrScannerModal() {
    if (html5QrCode && html5QrCode.isScanning) {
html5QrCode.stop().then(() => {
    console.log("QR Code scanning stopped.");
}).catch(err => {
    console.error("Failed to stop QR Code scanning.", err);
});
    }
    closeModal('qrScannerModal');
}

function startQrScanner() {
    if (html5QrCode && html5QrCode.isScanning) {
return;
    }
    
    html5QrCode = new Html5Qrcode("qr-reader");
    const qrCodeSuccessCallback = (decodedText, decodedResult) => {
closeQrScannerModal();
acceptQrShare(decodedText);
    };
    const config = { fps: 10, qrbox: { width: 250, height: 250 } };

    html5QrCode.start({ facingMode: "environment" }, config, qrCodeSuccessCallback)
.catch(err => {
    showNotification('Error starting QR scanner. Please grant camera permissions.', 'error');
    console.error(err);
});
}

async function acceptQrShare(scannedText) {
    try {
        // 1. Parse QR Data
        let qrData;
        try {
            qrData = JSON.parse(scannedText);
        } catch (e) {
            // Legacy/Fallback for old plain token support (optional)
            qrData = { t: scannedText, k: null }; 
        }

        const token = qrData.t;
        const keyHex = qrData.k;

        if (!token) throw new Error("Invalid QR Code format");

        // 2. Call Server to get the Encrypted Blob
        showNotification("Verifying QR Code...", "info");
        const res = await apiCall('/api/shared-passwords/accept-qr', {
            method: 'POST',
            body: JSON.stringify({ token })
        });

        if (!res.stage || res.stage !== 'decryption_needed') {
            throw new Error("Server did not return encryption data.");
        }

        if (!keyHex) throw new Error("This QR code does not contain the decryption key. It might be from an older version.");

        // 3. Decrypt the Blob using the Key from QR
        const rawQrKey = hex2buf(keyHex);
        const payloadString = await decryptData(res.encryptedPayload, rawQrKey);
        
        if (!payloadString || payloadString.startsWith("[Decryption")) {
            throw new Error("Failed to decrypt QR data. The code might be invalid.");
        }

        // 4. Re-Encrypt for MYSELF
        // We need to store this in 'shared_passwords', which expects an AES Key wrapped by MY RSA Public Key.
        
        // A. Get My Public Key
        const myProfileRes = await apiCall('/api/user/profile'); // Or fetch from session if you cached it
        // Note: Ideally, fetch user's own public key endpoint or derive from login
        // But simpler: just fetch from public endpoint:
        const keyRes = await fetch(`${API_BASE}/api/users/public-key?email=${encodeURIComponent(currentUser.email)}`);
        const keyData = await keyRes.json();
        const myPublicKey = await importKeyFromJSON(keyData.publicKey, "public");

        // B. Generate New Ephemeral Key for storage
        const storageKey = await generateEphemeralKey();
        const rawStorageKey = await exportRawKey(storageKey);

        // C. Encrypt Payload
        const newEncryptedPayload = await encryptData(payloadString, rawStorageKey);

        // D. Wrap Key with My Public Key
        const newEncryptedKey = await encryptRSA(rawStorageKey, myPublicKey);

        // 5. Finalize Share on Server
        const finalRes = await apiCall('/api/shared-passwords/finalize-qr', {
            method: 'POST',
            body: JSON.stringify({
                token: token,
                encryptedPayload: newEncryptedPayload,
                encryptedKey: newEncryptedKey
            })
        });

        showNotification(finalRes.message, 'success');
        loadSharingCenterContent(currentUser.plan);

    } catch (error) {
        console.error("QR Accept Error:", error);
        showNotification(`Error accepting share: ${error.message}`, 'error');
    }
}

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    // --- Standard Initializations ---
    initializeDarkMode();
    
    // Event listeners that must be set up on page load
    document.getElementById('themeToggle').addEventListener('click', toggleDarkMode);
    document.getElementById('darkModeToggle').addEventListener('change', toggleDarkMode);
    document.getElementById('biometricToggle').addEventListener('change', toggleBiometricOptions);
    
    // This is the family role listener that was missing from the snippet
    const roleSelect = document.getElementById('familyMemberRole');
    if (roleSelect) {
        roleSelect.addEventListener('change', updateRolePermissions);
    }
    
    // --- Event Listeners Setup (MUST BE BEFORE ANY EARLY RETURNS) ---
    // Set up category dropdown (only if it exists)
    const dropdown = document.getElementById('categoryDropdown');
    if (dropdown) {
        const selected = dropdown.querySelector('.dropdown-selected');
        const options = dropdown.querySelectorAll('.dropdown-option');
        const selectedText = document.getElementById('selectedCategoryText');

        // 1. Toggle dropdown open/close
        if (selected) {
            selected.addEventListener('click', () => {
                dropdown.classList.toggle('open');
            });
        }

        // 2. Handle option selection
        options.forEach(option => {
            option.addEventListener('click', () => {
                // Update the displayed text
                if (selectedText) {
                    selectedText.textContent = option.textContent;
                }
                
                // Remove 'selected' class from all options
                options.forEach(opt => opt.classList.remove('selected'));
                // Add 'selected' class to the clicked option
                option.classList.add('selected');
                
                // Get the value and call the sort function
                const value = option.getAttribute('data-value');
                sortPasswordsByCategory(value);
                
                // Close the dropdown
                dropdown.classList.remove('open');
            });
        });

        // 3. Close dropdown when clicking outside
        window.addEventListener('click', (e) => {
            if (!dropdown.contains(e.target)) {
                dropdown.classList.remove('open');
            }
        });
    }

    // Event delegation for data-action attributes (replaces inline onclick handlers)
    // Use capture phase to ensure we catch the event early
    console.log('Setting up click event delegation for data-action attributes');
    document.addEventListener('click', function(e) {
        // Find the element with data-action, checking both the clicked element and its parents
        let target = e.target;
        
        // If the clicked element doesn't have data-action, look for it in parent elements
        if (!target || (target.hasAttribute && !target.hasAttribute('data-action'))) {
            target = e.target.closest('[data-action]');
        }
        
        if (!target) return;
        
        const action = target.getAttribute('data-action');
        const arg = target.getAttribute('data-arg');
        
        // Debug logging - always log to see if clicks are being detected
        console.log('Click detected - Action:', action, 'Arg:', arg, 'Target:', target.tagName, target.className, 'Element:', target);
        
        // Map actions to functions
        const actionMap = {
            'showClaimModal': () => showClaimModal(),
            'submitClaimInvite': () => submitClaimInvite(),
            'togglePassword': () => {
                if (!arg) {
                    console.error('togglePassword called without arg');
                    return;
                }
                console.log('Calling togglePassword with:', arg);
                togglePassword(arg);
            },
            'login': () => login(),
            'register': () => register(),
            'verifyEmail': () => verifyEmail(),
            'resendCode': () => resendCode(),
            'sendResetLink': () => sendResetLink(),
            'resetPassword': () => resetPassword(),
            'showAuthScreen': () => showAuthScreen(arg),
            'showDashboardView': () => {
                const navLink = target.closest('a') || target;
                showDashboardView(arg, navLink);
            },
            'showAddPasswordModal': () => showAddPasswordModal(),
            'addPassword': () => addPassword(),
            'closeModal': () => closeModal(arg),
            'showChangePasswordModal': () => showChangePasswordModal(),
            'showChangePinModal': () => showChangePinModal(),
            'showChangeEmailModal': () => showChangeEmailModal(),
            'requestEmailChange': () => requestEmailChange(),
            'verifyEmailChange': () => verifyEmailChange(),
            'showDeleteAccountModal': () => showDeleteAccountModal(),
            'deleteAccount': () => deleteAccount(),
            'showDeleteFamilyModal': () => showDeleteFamilyModal(),
            'deleteFamilyGroup': () => deleteFamilyGroup(),
            'showLeaveFamilyModal': () => showLeaveFamilyModal(),
            'leaveFamilyGroup': () => leaveFamilyGroup(),
            'showCreateFamilyModal': () => showCreateFamilyModal(),
            'createFamilyGroup': () => createFamilyGroup(),
            'showInviteFamilyModal': () => showInviteFamilyModal(),
            'inviteFamilyMember': () => inviteFamilyMember(),
            'showAddFamilyVaultModal': () => showAddFamilyVaultModal(),
            'addToFamilyVault': () => addToFamilyVault(),
            'showShareToFamilyVaultModal': () => showShareToFamilyVaultModal(arg),
            'shareToFamilyVault': () => shareToFamilyVault(),
            'sharePassword': () => sharePassword(),
            'generateQrCodeForSharing': () => generateQrCodeForSharing(),
            'showQrScannerModal': () => showQrScannerModal(),
            'closeQrScannerModal': () => closeQrScannerModal(),
            'verifyPin': () => verifyPin(),
            'copyPassword': () => copyPassword(),
            'exportActivityLog': () => exportActivityLog(e),
            'clearActivityLog': () => clearActivityLog(),
            'upgradePlan': () => upgradePlan(arg),
            'cancelSubscription': () => cancelSubscription(arg),
            'enableEmergencyAccess': () => enableEmergencyAccess(),
            'disableEmergencyAccess': () => disableEmergencyAccess(),
            'removeFamilyMember': () => removeFamilyMember(arg),
            'revokeShare': () => revokeShare(arg),
            'logout': () => logout(),
            'changePassword': () => changePassword(),
            'changePin': () => changePin(),
            'enableEditMode': () => enableEditMode(),
            'cancelEditMode': () => cancelEditMode(),
            'saveEditedPassword': () => saveEditedPassword()
        };
        
        // Execute the action if it exists
        if (action && actionMap[action]) {
            e.preventDefault();
            e.stopPropagation();
            console.log('Executing action:', action);
            try {
                actionMap[action]();
            } catch (error) {
                console.error('Error executing action:', action, error);
            }
        } else if (action) {
            console.warn('Action not found in actionMap:', action);
        }
    });

    // --- URL and Session Handling Logic (AFTER EVENT LISTENERS ARE SET UP) ---
    const urlParams = new URLSearchParams(window.location.search);
    // It now correctly looks for 'reset_token'.
    const resetToken = urlParams.get('reset_token');

    // 1. Check for a Password Reset Token first.
    if (resetToken) {
        console.log("Password reset token found in URL. Displaying reset form.");
        
        window.passwordResetToken = resetToken;
        showAuthScreen('resetPasswordScreen');
        history.replaceState({}, document.title, window.location.pathname);
        return; 
    }

    // 2. If no reset token, check for an existing login session.
    const savedToken = localStorage.getItem('authToken');
    const savedUser = localStorage.getItem('currentUser');
    
    if (savedToken && savedUser) {
        console.log("Existing session found. Proceeding to dashboard.");
        authToken = savedToken;
        currentUser = JSON.parse(savedUser);

        loadKeyFromSession().then(async(key) => {
            if (key) {
                sessionMasterKey = key;

                const encPrivKey = localStorage.getItem('ep_enc_private_key');
                if (encPrivKey) {
                    try {
                        // This await requires the callback to be async
                        const pkJSON = await decryptData(encPrivKey, key);
                        sessionPrivateKey = await importKeyFromJSON(pkJSON, "private");
                        console.log("Private Key restored from session.");
                    } catch(e) { 
                        console.error("PK restore error", e); 
                    }
                }

                console.log("Encryption key restored from session.");
                showDashboard();
            } else {
                console.log("Session key missing. User must re-login.");
                logout(); // Security: If key is gone, they must login to re-derive it.
            }
        });

        //showDashboard();
    } else {
        // 3. If nothing else, show the default login screen.
        console.log("No session found. Showing login screen.");
        showAuthScreen('loginScreen');
    }

    // Event delegation for data-keyup attributes (replaces inline onkeyup handlers)
    document.addEventListener('keyup', function(e) {
        const target = e.target.closest('[data-keyup]');
        if (!target) return;
        
        const action = target.getAttribute('data-keyup');
        
        if (action === 'searchPasswords') {
            searchPasswords();
        }
    });
});
// Utility function to wait for DOM elements to be ready
function waitForElement(selector, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        
        function checkElement() {
            const element = document.getElementById(selector);
            if (element) {
                resolve(element);
            } else if (Date.now() - startTime >= timeout) {
                reject(new Error(`Element ${selector} not found after ${timeout}ms`));
            } else {
                setTimeout(checkElement, 100);
            }
        }
        
        checkElement();
    });
}

// FIXED: Event delegation for invitation buttons
document.addEventListener('click', async function(e) {
    // Handle accept invitation
    if (e.target.closest('.accept-invite')) {
        e.preventDefault();
        const button = e.target.closest('.accept-invite');
        const token = button.getAttribute('data-token');
        
        if (confirm('Join this family? You will get Family plan benefits!')) {
            try {
                const result = await apiCall('/api/family/accept-invitation', {
                    method: 'POST',
                    body: JSON.stringify({ token })
                });
                
                // Update user plan and UI
                currentUser.plan = 'family';
                updatePlanUI('family');
                showNotification(`🎉 Welcome to Family plan! Joined ${result.familyName} as ${result.role}`);
                
                // Refresh the view
                loadFamilySharingContent('family');
                
            } catch (error) {
                showNotification('Error: ' + error.message, 'error');
            }
        }
    }
    
    // Handle decline invitation
    if (e.target.closest('.decline-invite')) {
        e.preventDefault();
        const button = e.target.closest('.decline-invite');
        const token = button.getAttribute('data-token');
        
        if (confirm('Decline this family invitation?')) {
            try {
                await apiCall('/api/family/decline-invitation', {
                    method: 'POST',
                    body: JSON.stringify({ token })
                });
                
                showNotification('Invitation declined');
                loadFamilySharingContent(currentUser.plan);
                
            } catch (error) {
                showNotification('Error: ' + error.message, 'error');
            }
        }
    }
});

function showLeaveFamilyModal() {
    // Check if user is a child account first
    checkFamilyOwnershipAndRole().then(({ isOwner, role }) => {
        if (role === 'child') {
            showNotification('Child accounts cannot leave the family. Please ask the family owner to remove you.', 'error');
            return;
        }
        
        if (isOwner) {
            showNotification('Family owners cannot leave the family. Please delete the family group instead.', 'error');
            return;
        }
        
        // For parent accounts, show confirmation
        if (confirm('Are you sure you want to leave this family group? You will be restored to your previous plan.')) {
            leaveFamilyGroup();
        }
    }).catch(error => {
        showNotification('Error checking family role: ' + error.message, 'error');
    });
}

async function leaveFamilyGroup() {
    try {
        const result = await apiCall('/api/family/leave', {
            method: 'POST'
        });

        // Update user's plan to what they were restored to
        currentUser.plan = result.newPlan;
        updatePlanUI(result.newPlan);
        updateSubscriptionView(result.newPlan);
        updateSettingsView();
        
        showNotification(`You have left the family group successfully. Restored to ${result.newPlan} plan.`, 'success');
        
        // Refresh the family sharing view
        loadFamilySharingContent(result.newPlan);
        
    } catch (error) {
        if (error.message.includes('Child accounts cannot leave')) {
            showNotification('Child accounts cannot leave the family. Please ask the family owner to remove you.', 'error');
        } else if (error.message.includes('Family owner cannot leave')) {
            showNotification('Family owners cannot leave the family. Please delete the family group instead.', 'error');
        } else {
            showNotification('Error leaving family group: ' + error.message, 'error');
        }
    }
}

async function completeFamilyVaultSharingWithPin(pin) {
    try {
        const btn = document.querySelector('#pinModal .btn-primary');
        if(btn) { btn.innerText = "Encrypting..."; btn.disabled = true; }

        if (!window.pendingFamilyShare) throw new Error('No pending family share data');
        
        // 1. Get the Settings
        const { passwordId, shareWith } = window.pendingFamilyShare;

        // 2. Fetch Personal Password (to get the secret data)
        // We use the PIN to verify request
        const detailRes = await apiCall(`/api/passwords/${passwordId}/view`, {
            method: 'POST',
            body: JSON.stringify({ pin })
        });
        
        const personalItem = detailRes.password;
        if (!sessionMasterKey) throw new Error("Session key missing. Please log in again.");

        // 3. Decrypt Personal Data (Unlock it)
        const plainUsername = await decryptData(personalItem.username, sessionMasterKey);
        const plainPassword = await decryptData(personalItem.password, sessionMasterKey);
        const plainUrl = await decryptData(personalItem.url, sessionMasterKey);
        const plainNotes = await decryptData(personalItem.notes, sessionMasterKey);

        // 4. Get Family Keys (The list of possible recipients)
        const keysRes = await apiCall('/api/family/public-keys');
        const allMembers = keysRes.keys || [];
        const currentUserId = keysRes.currentUserId;

        if (allMembers.length === 0) throw new Error("No family members found.");

        // 5. PRIVACY FILTER: Decide who gets a key
        let recipients = [];

        if (shareWith === 'all') {
            recipients = allMembers; // Everyone gets a key
        } 
        else if (shareWith === 'parents') {
            // Only Parents + Yourself get a key
            recipients = allMembers.filter(m => m.role === 'parent' || m.id === currentUserId);
        } 
        else {
            // SPECIFIC USER MODE
            // Only the Target + Yourself get a key. 
            // The Owner is EXCLUDED (unless they are the target or you).
            const targetId = parseInt(shareWith);
            recipients = allMembers.filter(m => m.id === targetId || m.id === currentUserId);
        }

        console.log(`Generating keys for ${recipients.length} users. Owner excluded if not in list.`);

        // 6. Generate New AES Key for this Shared Item
        const ephemeralKey = await generateEphemeralKey();
        const rawEphemeralKey = await exportRawKey(ephemeralKey);

        // 7. Create the ZKA Bundle
        const payloadObj = {
            website: personalItem.website, // Taking name from personal item
            username: plainUsername,
            password: plainPassword,
            url: plainUrl,
            notes: plainNotes,
            category: personalItem.category
        };
        
        const payloadString = JSON.stringify(payloadObj);
        const encryptedPayload = await encryptData(payloadString, rawEphemeralKey);

        // 8. Encrypt Keys for Recipients Only
        const itemKeys = [];
        for (const member of recipients) {
            if (member.public_key) {
                try {
                    const memberPubKey = await importKeyFromJSON(member.public_key, "public");
                    const encKey = await encryptRSA(rawEphemeralKey, memberPubKey);
                    itemKeys.push({ userId: member.id, encryptedKey: encKey });
                } catch (e) {
                    console.error("Key error for member " + member.id);
                }
            }
        }

        if (itemKeys.length === 0) throw new Error("Failed to prepare encryption keys.");

        // 9. Send to Server
        console.log("Sending share type:", shareWith); // Debug log

        await apiCall(`/api/passwords/${passwordId}/share-to-family`, {
            method: 'POST',
            body: JSON.stringify({
                // METADATA
                website: personalItem.website,
                category: personalItem.category,
                
                // IMPORTANT: Send the specific ID or 'all'/'parents'
                shareWith: shareWith, 

                // DUMMY DATA
                username: "See Encrypted Blob",
                url: "",
                notes: "",

                // REAL DATA
                encryptedPayload: encryptedPayload,
                itemKeys: itemKeys
            })
        });

        showNotification('Password shared to family vault securely!');
        if(btn) { 
            btn.innerText = "Verify PIN"; 
            btn.disabled = false; 
        }
        closeModal('pinModal');
        window.pendingFamilyShare = null;
        
        if(currentUser.plan === 'family') loadFamilySharingContent('family');

    } catch (error) {
        console.error("Share Error:", error);
        alert("Error sharing: " + error.message);
        if(btn) { btn.innerText = "Verify PIN"; btn.disabled = false; }
    }
}

// New function to handle adding to family vault after PIN verification
async function completeFamilyVaultAddWithPin(pin) {
    // FIX: Define btn here so it exists for the catch block
    const btn = document.querySelector('#pinModal .btn-primary');
    
    try {
        if(btn) { btn.innerText = "Encrypting..."; btn.disabled = true; }

        if (!window.pendingFamilyAdd) throw new Error('No pending data.');
        
        const { website, username, password, category, url, notes, shareWith } = window.pendingFamilyAdd;

        // SANITY CHECK: Default to 'all' if undefined, just like the working function
        const cleanShareWith = shareWith || 'all';

        console.log(`Starting Secure Add. Mode: ${cleanShareWith}`);

        // 1. Fetch Keys
        const keysRes = await apiCall('/api/family/public-keys');
        const allMembers = keysRes.keys || [];
        const currentUserId = keysRes.currentUserId;

        if (allMembers.length === 0) throw new Error("No family keys found.");

        // 2. Filter Recipients (Exact same logic as Sharing)
        let recipients = [];
        if (cleanShareWith === 'all') {
            recipients = allMembers;
        } else if (cleanShareWith === 'parents') {
            recipients = allMembers.filter(m => m.role === 'parent' || m.id === currentUserId);
        } else {
            const targetId = parseInt(cleanShareWith);
            recipients = allMembers.filter(m => m.id === targetId || m.id === currentUserId);
        }

        // 3. Encrypt Payload
        const ephemeralKey = await generateEphemeralKey();
        const rawEphemeralKey = await exportRawKey(ephemeralKey);

        const payloadObj = {
            website: website || "",
            username: username || "",
            password: password || "",
            url: url || "",
            notes: notes || "",
            category: category || "General"
        };
        const encryptedPayload = await encryptData(JSON.stringify(payloadObj), rawEphemeralKey);

        // 4. Encrypt Keys
        const itemKeys = [];
        for (const member of recipients) {
            if (member.public_key) {
                try {
                    const memberPubKey = await importKeyFromJSON(member.public_key, "public");
                    const encKey = await encryptRSA(rawEphemeralKey, memberPubKey);
                    itemKeys.push({ userId: member.id, encryptedKey: encKey });
                } catch (e) {
                    console.error("Skipping member " + member.id);
                }
            }
        }

        // 5. Send to Server (Exact same structure as Sharing)
        await apiCall('/api/family/vault/passwords', {
            method: 'POST',
            body: JSON.stringify({
                website: website || "Unknown",
                category: category || "General",
                shareWith: cleanShareWith, // Pass the ID/'all'
                username: "See Encrypted Blob",
                url: "",
                notes: "",
                encryptedPayload: encryptedPayload,
                itemKeys: itemKeys,
                pin: pin
            })
        });

        showNotification('Added to Family Vault!');
        if(btn) { 
            btn.innerText = "Verify PIN"; 
            btn.disabled = false; 
        }
        closeModal('pinModal');
        window.pendingFamilyAdd = null;
        
        if(currentUser.plan === 'family') loadFamilySharingContent('family');

    } catch (error) {
        console.error("Family Add Error:", error);
        alert("Error: " + error.message);
        // This will now work
        if(btn) { btn.innerText = "Verify PIN"; btn.disabled = false; }
    }
}

function getFlagUrl(countryCode) {
    if (!countryCode || countryCode.length !== 2 || countryCode === 'XX') {
        return null; // Return null if the country is unknown
    }
    // Request a 40px wide image instead of 20px for high-DPI displays.
    return `https://flagcdn.com/w40/${countryCode.toLowerCase()}.png`;
}

function showChangePasswordModal() {
    const currentField = document.getElementById('changePasswordCurrent');
    const newField = document.getElementById('changePasswordNew');
    const confirmField = document.getElementById('changePasswordConfirm');
    const alertBox = document.getElementById('changePasswordAlert');

    if (currentField && newField && confirmField) {
        currentField.value = '';
        newField.value = '';
        confirmField.value = '';
    }

    if (alertBox) {
        alertBox.style.display = 'none';
        alertBox.textContent = '';
    }

    showModal('changePasswordModal');
}

async function changePassword() {
    const currentPassword = document.getElementById('changePasswordCurrent')?.value;
    const newPassword = document.getElementById('changePasswordNew')?.value;
    const confirmPassword = document.getElementById('changePasswordConfirm')?.value;
    const alertBox = document.getElementById('changePasswordAlert');

    if (alertBox) alertBox.style.display = 'none';
    const btn = document.querySelector('button[data-action="changePassword"]');
    if(btn) { btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Processing Vault...'; btn.disabled = true; }

    try {
        // 1. Validation
        if (!currentPassword || !newPassword || !confirmPassword) throw new Error('Fill all fields.');
        if (newPassword !== confirmPassword) throw new Error('New passwords do not match.');
        if (newPassword.length < 8) throw new Error('Min 8 characters required.');

        // 2. Fetch Fresh Data (Salt, Keys, AND Personal Vault)
        console.log("Fetching vault data...");
        const [profileRes, vaultRes] = await Promise.all([
            apiCall('/api/user/profile'),
            apiCall('/api/passwords') // Fetch personal passwords
        ]);
        
        const oldSalt = profileRes.kdf_salt;
        const encryptedPrivateKeyBlob = profileRes.encrypted_private_key;
        const personalVault = vaultRes.passwords || [];

        // 3. Derive OLD Keys
        console.log("Unlocking with old password...");
        const oldMasterKey = await deriveMasterKey(currentPassword, oldSalt);
        const oldAuthKey = await deriveAuthKey(oldMasterKey);

        // 4. Decrypt & Re-Encrypt PRIVATE KEY
        let rawPrivateKeyJSON = await decryptData(encryptedPrivateKeyBlob, oldMasterKey);
        // Verify decryption worked
        try { JSON.parse(rawPrivateKeyJSON); } catch(e) { throw new Error("Incorrect current password."); }

        // 5. Derive NEW Keys
        console.log("Generating new keys...");
        const newSalt = generateSalt();
        const newMasterKey = await deriveMasterKey(newPassword, newSalt);
        const newAuthKey = await deriveAuthKey(newMasterKey);

        const newEncryptedPrivateKey = await encryptData(rawPrivateKeyJSON, newMasterKey);

        // 6. Decrypt & Re-Encrypt PERSONAL VAULT
        console.log(`Re-encrypting ${personalVault.length} passwords...`);
        const updatedVault = [];

        for (const item of personalVault) {
            try {
                // Decrypt with OLD
                const plainUsername = await decryptData(item.username, oldMasterKey);
                const plainPassword = await decryptData(item.encrypted_password || item.password, oldMasterKey); // handle field name diff
                const plainUrl = await decryptData(item.url, oldMasterKey);
                const plainNotes = await decryptData(item.notes, oldMasterKey);

                // Encrypt with NEW
                const newUsername = await encryptData(plainUsername, newMasterKey);
                const newPassword = await encryptData(plainPassword, newMasterKey);
                const newUrl = await encryptData(plainUrl, newMasterKey);
                const newNotes = await encryptData(plainNotes, newMasterKey);

                updatedVault.push({
                    id: item.id,
                    username: newUsername,
                    password: newPassword,
                    url: newUrl,
                    notes: newNotes
                });
            } catch (e) {
                console.error("Failed to re-encrypt item:", item.id, e);
                // We skip broken items, but warn the user in console
            }
        }

        // 7. Send EVERYTHING to Server
        console.log("Uploading new vault...");
        await apiCall('/api/auth/change-password', {
            method: 'POST',
            body: JSON.stringify({
                currentPasswordHash: oldAuthKey,
                newPasswordHash: newAuthKey,
                newSalt: newSalt,
                newEncryptedPrivateKey: newEncryptedPrivateKey,
                updatedVault: updatedVault // The re-encrypted list
            })
        });

        showNotification('Password changed & Vault re-encrypted! Logging out...', 'success');
        closeModal('changePasswordModal');
        
        setTimeout(() => logout(), 1500);

    } catch (error) {
        console.error("Change Password Error:", error);
        if (alertBox) {
            alertBox.textContent = error.message;
            alertBox.className = 'alert alert-error';
            alertBox.style.display = 'block';
        } else {
            alert(error.message);
        }
    } finally {
        if(btn) { btn.innerHTML = 'Update Password'; btn.disabled = false; }
    }
}

function showChangePinModal() {
    const currentPin = document.getElementById('changePinCurrent');
    const newPin = document.getElementById('changePinNew');
    const confirmPin = document.getElementById('changePinConfirm');
    const alertBox = document.getElementById('changePinAlert');

    if (currentPin && newPin && confirmPin) {
        currentPin.value = '';
        newPin.value = '';
        confirmPin.value = '';
    }

    if (alertBox) {
        alertBox.style.display = 'none';
        alertBox.textContent = '';
    }

    showModal('changePinModal');
}

async function changePin() {
    const currentPin = document.getElementById('changePinCurrent')?.value.trim();
    const newPin = document.getElementById('changePinNew')?.value.trim();
    const confirmPin = document.getElementById('changePinConfirm')?.value.trim();
    const alertBox = document.getElementById('changePinAlert');

    if (!currentPin || !newPin || !confirmPin) {
        if (alertBox) {
            alertBox.textContent = 'Please complete all fields.';
            alertBox.className = 'alert alert-error';
            alertBox.style.display = 'block';
        }
        return;
    }

    if (newPin !== confirmPin) {
        if (alertBox) {
            alertBox.textContent = 'New PIN and confirmation do not match.';
            alertBox.className = 'alert alert-error';
            alertBox.style.display = 'block';
        }
        return;
    }

    if (newPin.length !== 4 || /\D/.test(newPin)) {
        if (alertBox) {
            alertBox.textContent = 'PIN must be exactly 4 digits.';
            alertBox.className = 'alert alert-error';
            alertBox.style.display = 'block';
        }
        return;
    }

    try {
        const result = await apiCall('/api/auth/change-pin', {
            method: 'POST',
            body: JSON.stringify({ currentPin, newPin })
        });

        showNotification(result.message || 'PIN updated successfully!');
        closeModal('changePinModal');
    } catch (error) {
        if (alertBox) {
            alertBox.textContent = error.message;
            alertBox.className = 'alert alert-error';
            alertBox.style.display = 'block';
        } else {
            showNotification('Unable to update PIN: ' + error.message, 'error');
        }
    }
}

// --- EDIT MODE FUNCTIONS ---

function enableEditMode() {
    // Toggle Buttons
    document.getElementById('btnEditPassword').classList.add('hidden');
    document.getElementById('btnCloseDetails').classList.add('hidden');
    document.getElementById('detailCopyBtn').classList.add('hidden');
    
    document.getElementById('btnSaveEdit').classList.remove('hidden');
    document.getElementById('btnCancelEdit').classList.remove('hidden');
    document.getElementById('passwordDetailsTitle').textContent = 'Edit Password';

    // Enable Inputs
    const inputs = document.querySelectorAll('.detail-input');
    inputs.forEach(input => {
        input.removeAttribute('readonly');
        input.removeAttribute('disabled');
        input.style.backgroundColor = '#fff'; // Visual cue
        input.style.border = '1px solid #4361ee'; // Visual cue
    });
    
    // Enable Password Field specifically
    const passInput = document.getElementById('detailPassword');
    passInput.removeAttribute('readonly');
    passInput.style.backgroundColor = '#fff';
    passInput.style.border = '1px solid #4361ee';
    
    // Show password characters so user knows what they are editing
    if(passInput.type === 'password') togglePassword('detailPassword');
}

function cancelEditMode() {
    // Toggle Buttons Back
    document.getElementById('btnEditPassword').classList.remove('hidden');
    document.getElementById('btnCloseDetails').classList.remove('hidden');
    document.getElementById('detailCopyBtn').classList.remove('hidden');
    
    document.getElementById('btnSaveEdit').classList.add('hidden');
    document.getElementById('btnCancelEdit').classList.add('hidden');
    document.getElementById('passwordDetailsTitle').textContent = 'Password Details';

    // Disable Inputs
    const inputs = document.querySelectorAll('.detail-input');
    inputs.forEach(input => {
        input.setAttribute('readonly', 'true');
        input.setAttribute('disabled', 'true');
        input.style.backgroundColor = ''; // Reset style
        input.style.border = ''; // Reset style
    });

    // Disable Password Field
    const passInput = document.getElementById('detailPassword');
    passInput.setAttribute('readonly', 'true');
    passInput.style.backgroundColor = '';
    passInput.style.border = '';
    
    // Mask password again
    passInput.type = 'password';
    const icon = passInput.parentNode.querySelector('i');
    if(icon) icon.className = 'fas fa-eye';
}

function saveEditedPassword() {
    // 1. Hide the Edit Modal (User inputs remain in the DOM)
    closeModal('passwordDetailsModal');

    // 2. Prepare PIN Modal
    document.getElementById('pinModalTitle').textContent = 'Enter PIN to Save Changes';
    document.getElementById('pinModalDescription').textContent = 'Please confirm your identity to update this password.';
    
    // 3. Set action and show PIN modal
    currentAction = 'save_edit'; 
    setupPinInputs();
    showModal('pinModal');
}

async function executeUpdatePassword(pin) {
    const website = document.getElementById('detailWebsite').value;
    const username = document.getElementById('detailUsername').value;
    const password = document.getElementById('detailPassword').value;
    const category = document.getElementById('detailCategory').value;
    const url = document.getElementById('detailUrl').value;
    const notes = document.getElementById('detailNotes').value;
    const strengthData = checkPasswordStrength(password);

    try {
        if (!sessionMasterKey) throw new Error("Session key missing. Please log in again.");

        // --- NEW: ENCRYPT BEFORE SENDING ---
        const encUsername = await encryptData(username, sessionMasterKey);
        const encPassword = await encryptData(password, sessionMasterKey);
        const encUrl = await encryptData(url || '', sessionMasterKey);
        const encNotes = await encryptData(notes || '', sessionMasterKey);

        // Send the ENCRYPTED blobs to the server
        const result = await apiCall(`/api/passwords/${currentPasswordId}`, {
            method: 'PUT',
            headers: { 'X-PIN-Verification': pin }, // Keep PIN for legacy auth check if needed
            body: JSON.stringify({
                website, // Plain text for sorting
                username: encUsername, // Encrypted
                password: encPassword, // Encrypted
                category, // Plain text
                url: encUrl,           // Encrypted
                notes: encNotes,        // Encrypted
                strengthScore: strengthData.score
            })
        });

        const plainDataObj = {
            website,
            username,
            password,
            url,
            notes,
            category // Ensure category is synced too
        };
        

        await resyncShares(currentPasswordId, plainDataObj); 

        showNotification(result.message, 'success');
        
        cancelEditMode(); 
        await loadAndUpdatePasswords(); 

    } catch (error) {
        showNotification('Update failed: ' + error.message, 'error');
    }
}

function showClaimModal() {
    document.getElementById('claimCodeInput').value = '';
    showModal('claimInviteModal');
}

async function submitClaimInvite() {
    const code = document.getElementById('claimCodeInput').value.trim().toUpperCase();
    if (!code) return showNotification("Please enter code", "error");

    const btn = document.querySelector('button[data-action="submitClaimInvite"]');
    const originalText = btn.textContent;
    btn.innerHTML = '<i class="fas fa-circle-notch btn-spinner"></i> Unlocking...';
    btn.disabled = true;

    try {
        // 1. Hash Code
        const inviteCodeHash = await hashInviteCode(code);

        // 2. Fetch Blob
        const result = await apiCall('/api/shares/claim', {
            method: 'POST',
            body: JSON.stringify({ inviteCodeHash })
        });

        // 3. Decrypt Blob with Code Key
        const inviteKey = await deriveKeyFromInviteCode(code);
        const inviteRawKey = await exportInviteKey(inviteKey);
        
        const payloadString = await decryptData(result.encryptedPayload, inviteRawKey);
        if (!payloadString || payloadString.startsWith("[Decryption")) throw new Error("Invalid code.");

        // 4. Re-Encrypt for My Vault
        // Get My Public Key
        const myKeyRes = await fetch(`${API_BASE}/api/users/public-key?email=${encodeURIComponent(currentUser.email)}`);
        const myKeyData = await myKeyRes.json();
        const myPublicKey = await importKeyFromJSON(myKeyData.publicKey, "public");

        // Generate Ephemeral
        const ephemeralKey = await generateEphemeralKey();
        const rawEphemeralKey = await window.crypto.subtle.exportKey("raw", ephemeralKey);
        
        const newEncPayload = await encryptData(payloadString, rawEphemeralKey);
        const newEncKey = await encryptRSA(rawEphemeralKey, myPublicKey);

        // 5. Finalize
        await apiCall('/api/shares/finalize-claim', {
            method: 'POST',
            body: JSON.stringify({
                passwordId: result.passwordId,
                originalSenderId: result.sharedByUserId,
                accessLevel: result.accessLevel,
                encryptedPayload: newEncPayload,
                encryptedKey: newEncKey,
                inviteCodeHash: inviteCodeHash // To delete the invite
            })
        });

        showNotification("Password claimed successfully!", "success");
        closeModal('claimInviteModal');
        loadSharingCenterContent(currentUser.plan);

    } catch (error) {
        showNotification(error.message, "error");
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}