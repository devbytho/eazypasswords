// Configuration
const API_BASE = 'https://securepass-backend.devbytho.workers.dev';
let currentUser = null;
let authToken = null;
let currentPasswordId = null;
let allPasswords = [];
let currentAction = 'view'; // 'view', 'copy', 'cancel_subscription', 'share_qr'
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

// Utility Functions
function showAuthScreen(screenName) {
    Object.values(authScreens).forEach(screen => {
        screen.style.display = 'none';
    });
    document.getElementById(screenName).style.display = 'block';
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
    
    // Show target view
    const targetView = document.getElementById(viewName + 'View');
    if (targetView) {
        // Remove hidden class first, then set display
        targetView.classList.remove('hidden');
        targetView.style.display = 'block';
        console.log('View displayed:', viewName + 'View');
    } else {
        console.error('View not found:', viewName + 'View');
        return;
    }
    
    // Update active nav link
    document.querySelectorAll('.nav-links a').forEach(link => {
        link.classList.remove('active');
    });
    
    // Set active class on the clicked element or find by data-arg
    if (clickedElement) {
        clickedElement.classList.add('active');
    } else {
        // Fallback: find the link by data-arg attribute
        const navLink = document.querySelector(`.nav-links a[data-arg="${viewName}"]`);
        if (navLink) {
            navLink.classList.add('active');
        }
    }
    
    // Load appropriate data based on view
    if (viewName === 'dashboard') {
        console.log('Updating dashboard view with current passwords...');
        updatePasswordLists();
        loadDashboardData();
    } else if (viewName === 'passwords') {
        console.log('Updating passwords view with current passwords...');
        updatePasswordLists();
    }
    
    // Update subscription view if needed
    if (viewName === 'subscription') {
        updateSubscriptionView(currentUser?.plan || 'free');
    }
    
    // Update settings view to show/hide family management
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
  
  if (currentUser?.plan === 'family') {
    familySection.style.display = 'block';
    
    // Check if user is family owner and their role
    checkFamilyOwnershipAndRole().then(({ isOwner, role }) => {
      if (isOwner) {
deleteFamilyItem.style.display = 'flex';
leaveFamilyItem.style.display = 'none';
childAccountMessage.style.display = 'none';
      } else if (role === 'parent') {
deleteFamilyItem.style.display = 'none';
leaveFamilyItem.style.display = 'flex';
childAccountMessage.style.display = 'none';
      } else {
// Child account - show message only
deleteFamilyItem.style.display = 'none';
leaveFamilyItem.style.display = 'none';
childAccountMessage.style.display = 'flex';
      }
    }).catch(error => {
      console.error('Error checking family ownership:', error);
      // Default to showing leave option if we can't determine ownership
      deleteFamilyItem.style.display = 'none';
      leaveFamilyItem.style.display = 'flex';
      childAccountMessage.style.display = 'none';
    });
  } else {
    familySection.style.display = 'none';
  }
}
    async function checkFamilyOwnershipAndRole() {
  try {
    const result = await apiCall('/api/family');
    if (result.family) {
      const userMember = result.family.members.find(member => member.id === currentUser.id);
      return {
isOwner: result.family.owner_id === currentUser.id,
role: userMember ? userMember.role : 'child'
      };
    }
    return { isOwner: false, role: 'child' };
  } catch (error) {
    console.error('Error checking family ownership:', error);
    return { isOwner: false, role: 'child' };
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
                <button class="btn btn-primary" style="margin-top: 24px; padding: 12px 32px; font-size: 15px; font-weight: 600;" onclick="showDashboardView('subscription')">
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
                
                <div style="margin-top: 32px;">
                    <div class="list-header">
                        <div class="list-title">Shared By Me</div>
                    </div>
                    <div id="sharedByMeList">
                        ${sharedByMe.length === 0 ? `
                            <div class="empty-state" style="padding: 30px 20px;">
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
                                    <button class="action-btn" onclick="revokeShare(${share.id})" title="Revoke Share">
                                        <i class="fas fa-times"></i>
                                    </button>
                                    <!-- 👆 END OF FIX 👆 -->
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;

            // Add event listeners for shared password actions
            setTimeout(() => {
                // Listener for "Shared WITH Me"
                document.querySelectorAll('#sharedWithMeList .view-password, #sharedWithMeList .copy-password').forEach(btn => {
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
                
                // Listener for "Shared BY Me" (the one we are fixing)
                document.querySelectorAll('#sharedByMeList .view-password, #sharedByMeList .copy-password').forEach(btn => {
                    btn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        const passwordId = this.getAttribute('data-id');
                        // These are your own passwords, so isShared is false
                        if (this.classList.contains('view-password')) {
                            showPasswordDetails(passwordId, false);
                        } else {
                            copyPasswordToClipboard(passwordId, false);
                        }
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
    
    // Load pending invitations for ALL users
    let pendingInvitations = [];
    try {
        const invitationsResult = await apiCall('/api/family/my-invitations');
        pendingInvitations = invitationsResult.invitations || [];
    } catch (error) {
        console.error('Error loading invitations:', error);
    }

    // Invitations section - shown to ALL users
    const invitationsSection = pendingInvitations.length > 0 ? `
        <div class="password-list" style="margin-bottom: 32px;">
            <div class="list-header">
                <div class="list-title">Pending Family Invitations</div>
                <div class="card-description">You have ${pendingInvitations.length} pending invitation(s)</div>
            </div>
            <div id="pendingInvitationsList">
                ${pendingInvitations.map(invite => `
                    <div class="password-item">
                        <div class="password-icon" style="background: var(--warning);">
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
                                <i class="fas fa-check" style="color: var(--success);"></i>
                            </button>
                            <button class="action-btn decline-invite" data-token="${invite.token}" title="Decline Invitation">
                                <i class="fas fa-times" style="color: var(--danger);"></i>
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    ` : `
        <div class="empty-state" style="margin-bottom: 32px;">
            <i class="fas fa-envelope-open"></i>
            <h3>No pending invitations</h3>
            <p>When someone invites you to their family, it will appear here</p>
        </div>
    `;

    // Free/Premium users see only invitations
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
                    <button class="btn btn-primary" style="margin-top: 24px; padding: 12px 32px; font-size: 15px; font-weight: 600;" onclick="showDashboardView('subscription')">
                        Upgrade to Family
                    </button>
                ` : ''}
            </div>
        `;
    } 
    // Family plan users see full management
    else if (userPlan === 'family') {
        try {
            const result = await apiCall('/api/family');
            const family = result.family;
            
            // Handle case where user has family plan but no family group
            if (!family) {
                contentDiv.innerHTML = `
                    ${invitationsSection}
                    
                    <div class="feature-access">
                        <i class="fas fa-home feature-access-icon"></i>
                        <h2 class="feature-access-title">Create Your Family Group</h2>
                        <p class="feature-access-description">Start by creating a family group to share passwords securely with your family members.</p>
                        <button class="btn btn-primary" style="margin-top: 24px; padding: 12px 32px; font-size: 15px; font-weight: 600;" onclick="showCreateFamilyModal()">
                            Create Family Group
                        </button>
                    </div>
                `;
                return;
            }

            // Load family vault passwords
            const vaultResult = await apiCall('/api/family/vault/passwords');
            const vaultPasswords = vaultResult.passwords || [];

            const emergencyAccessSection = family.emergencyAccess && family.emergencyAccess.enabled ? `
                <div class="emergency-access-banner">
                    <i class="fas fa-exclamation-triangle" style="margin-right: 8px;"></i>
                    <strong>Emergency Access Active</strong>
                    <p style="margin: 8px 0 0 0; font-size: 14px;">
                        All family members have access to shared passwords for emergency purposes.
                    </p>
                    <button class="btn btn-secondary" style="margin-top: 12px; background: rgba(255,255,255,0.2);" onclick="disableEmergencyAccess()">
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
                        <button class="add-btn" onclick="showInviteFamilyModal()">
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
                                        <button class="action-btn" onclick="removeFamilyMember(${member.id})" title="Remove Member">
                                            <i class="fas fa-times"></i>
                                        </button>
                                    </div>
                                ` : ''}
                            </div>
                        `).join('')}
                    </div>
                </div>
                
                <div style="margin-top: 32px;">
                    <div class="list-header">
                        <div class="list-title">Family Vault</div>
                        <div style="display: flex; gap: 12px;">
                            <button class="add-btn" onclick="showAddFamilyVaultModal()">
                                <i class="fas fa-plus"></i> Add to Vault
                            </button>
                            ${family.owner_id === currentUser.id ? `
                                <button class="add-btn" onclick="enableEmergencyAccess()">
                                    <i class="fas fa-shield-alt"></i> Enable Emergency Access
                                </button>
                            ` : ''}
                        </div>
                    </div>
                    <div id="familyVaultContent">
                        ${vaultPasswords.length === 0 ? `
                            <div class="empty-state" style="padding: 30px 20px;">
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
                                    <div class="password-username" style="color: var(--info); font-size: 12px;">
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

            // Add event listeners for family vault actions
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
                <button class="btn btn-primary" style="margin-top: 24px; padding: 12px 32px; font-size: 15px; font-weight: 600;" onclick="showDashboardView('subscription')">
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
        // [RESTORED] Feature gating for free users with benefit boxes
        contentDiv.innerHTML = `
            <div class="feature-access">
                <i class="fas fa-history feature-access-icon"></i>
                <h2 class="feature-access-title">Activity Log</h2>
                <p class="feature-access-description">Monitor all access, logins, and changes to your password vault with a detailed audit trail for enhanced security.</p>
                <div class="required-plan">Requires Premium Plan</div>
                <button class="btn btn-primary" style="margin-top: 24px;" onclick="showDashboardView('subscription')">
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

    // For premium/family users (unchanged)
    contentDiv.innerHTML = `
        <div class="password-list">
            <div class="list-header">
                <div class="list-title">Recent Account Activity</div>
                 <div class="log-actions">
                    <button class="btn btn-secondary" onclick="exportActivityLog()">
                        <i class="fas fa-download"></i> Export Data
                    </button>
                    <button class="danger-btn" onclick="clearActivityLog()">
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

 async function exportActivityLog() {
    const exportButton = event.target.closest('button');
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
                const escaped = ('' + log[header]).replace(/"/g, '""'); // Escape double quotes
                return `"${escaped}"`;
            });
            csvRows.push(values.join(','));
        });
        const csvString = csvRows.join('\n');

        // Trigger file download
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
        exportButton.innerHTML = '<i class="fas fa-download"></i> Export Data';
        exportButton.disabled = false;
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
        // Refresh the view to show the now-empty list
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

    // Create the HTML for either the flag image or the fallback globe emoji
    let flagHtml = `<span class="log-flag" title="${countryTitle}">🌐</span>`; // Default to globe

    if (flagUrl) {
        // If we have a valid flag URL, get the full country name for the title
        try {
            countryTitle = new Intl.DisplayNames(['en'], { type: 'region' }).of(log.country_code);
        } catch (e) {
            countryTitle = log.country_code;
        }
        // Use an <img> tag for the flag
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
    const input = document.getElementById(inputId);
    const icon = input.parentNode.querySelector('i');
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

// Dark Mode Functions
function toggleDarkMode() {
    document.body.classList.toggle('dark-mode');
    const isDarkMode = document.body.classList.contains('dark-mode');
    localStorage.setItem('darkMode', isDarkMode);
    
    // Update theme toggle icon
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

// Biometric Functions
function toggleBiometricOptions() {
    const biometricToggle = document.getElementById('biometricToggle');
    const biometricOptions = document.getElementById('biometricOptions');
    
    if (biometricToggle.checked) {
        biometricOptions.style.display = 'block';
        // Check if WebAuthn is supported
        if (!window.PublicKeyCredential) {
            showNotification('Biometric authentication is not supported on this device/browser', 'error');
            biometricToggle.checked = false;
            biometricOptions.style.display = 'none';
            return;
        }
        
        // Initialize biometric options based on device capabilities
        initializeBiometricOptions();
    } else {
        biometricOptions.style.display = 'none';
        // Disable all biometric options
        document.getElementById('fingerprintToggle').checked = false;
        document.getElementById('faceRecognitionToggle').checked = false;
    }
}

function initializeBiometricOptions() {
    // In a real implementation, you would check device capabilities
    // For this demo, we'll simulate both options being available
    document.getElementById('fingerprintToggle').disabled = false;
    document.getElementById('faceRecognitionToggle').disabled = false;
}

// API Functions
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
            // For family endpoint, don't throw error for 404 - let the frontend handle it
            if (endpoint === '/api/family' && response.status === 404) {
                return { family: null }; // Return empty family instead of throwing error
            }
            throw new Error(data.error || 'API request failed');
        }
        
        return data;
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
}

// Get user's current plan from database
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

    // Remove featured styling from all cards initially
    premiumPlanCard.classList.remove('featured');
    familyPlanCard.classList.remove('featured');

    // Reset all buttons and sections
    premiumPlanBtn.style.display = 'block';
    familyPlanBtn.style.display = 'block';
    premiumCancelSection.style.display = 'none';
    familyCancelSection.style.display = 'none';
    
    // Show/hide free plan and missing features based on current plan
    if (currentPlan === 'free') {
        freePlanCard.style.display = 'block';
        missingFeatures.style.display = 'block';
        currentPlanDisplay.textContent = 'Free';
        planDescription.textContent = 'You\'re currently on the Free plan with basic features.';
        
        // Add featured styling to premium plan
        premiumPlanCard.classList.add('featured');
        
        premiumPlanBtn.textContent = 'Upgrade to Premium';
        premiumPlanBtn.onclick = () => upgradePlan('premium');
        
        familyPlanBtn.textContent = 'Choose Family Plan';
        familyPlanBtn.onclick = () => upgradePlan('family');
        
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
        familyPlanBtn.onclick = () => upgradePlan('family');
        
        document.getElementById('cancelPremiumBtn').onclick = () => cancelSubscription('premium');
        
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
        premiumPlanBtn.onclick = () => upgradePlan('premium');
        
        document.getElementById('cancelFamilyBtn').onclick = () => cancelSubscription('family');
    }
}

// Upgrade plan function
async function upgradePlan(planName) {
    try {
        const result = await apiCall('/api/auth/upgrade-plan', {
            method: 'POST',
            body: JSON.stringify({ plan: planName })
        });

        // Update current user plan
        currentUser.plan = planName;
        
        // Update UI to reflect new plan
        updatePlanUI(planName);
        updateSubscriptionView(planName);
        updateSettingsView();
        
        showNotification(`Successfully upgraded to ${planName} plan!`);
        
    } catch (error) {
        showNotification('Error upgrading plan: ' + error.message, 'error');
    }
}

// Cancel subscription function
async function cancelSubscription(currentPlan) {
    // Update PIN modal for cancellation
    document.getElementById('pinModalTitle').textContent = 'Verify PIN to Cancel Subscription';
    document.getElementById('pinModalDescription').textContent = 'For security reasons, please enter your PIN to cancel your subscription.';
    
    // Show PIN verification modal for cancellation
    currentAction = 'cancel_subscription';
    setupPinInputs();
    showModal('pinModal');
    
    // Store the current plan for cancellation
    window.pendingCancellationPlan = currentPlan;
}

// Handle subscription cancellation after PIN verification
async function processSubscriptionCancellation(pin) {
    try {
        // Verify PIN first
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
                // If family deletion fails, still try to downgrade the plan
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

// Update the verifyPin function to handle family vault
async function verifyPin() {
    const inputs = document.querySelectorAll('#pinModal .pin-input');
    const pin = Array.from(inputs).map(input => input.value).join('');

    if (pin.length !== 4) {
alert('Please enter a complete 4-digit PIN');
return;
    }

    try {
// Clear PIN inputs immediately for security
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

    } catch (error) {
alert('Invalid PIN or error: ' + error.message);
setupPinInputs();
    }
}
// Update the updatePlanUI function
function updatePlanUI(planName) {
    // Update sidebar upgrade card
    const upgradeCard = document.getElementById('sidebarUpgradeCard');
    if (upgradeCard) {
        if (planName !== 'free') {
            upgradeCard.innerHTML = `
                <div class="upgrade-icon" style="background: var(--success);">
                    <i class="fas fa-crown"></i>
                </div>
                <div class="upgrade-title">${planName.charAt(0).toUpperCase() + planName.slice(1)} Plan</div>
                <div class="upgrade-description">You're on the ${planName} plan. Enjoy premium features!</div>
                <button class="upgrade-btn-sidebar" onclick="showDashboardView('subscription')">
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
                <button class="upgrade-btn-sidebar" onclick="showDashboardView('subscription')">
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

    if (pin.length !== 4) {
        showAlert('registerAlert', 'PIN must be 4 digits');
        return;
    }

    try {
        const result = await apiCall('/api/auth/register', {
            method: 'POST',
            body: JSON.stringify({ name, email, password, pin })
        });

        currentUser = { email, name, plan: 'free' };
        showAlert('registerAlert', 'Registration successful! Check your email for verification code.', 'success');
        
        // Auto-fill verification code for demo
        //document.getElementById('verifyCode').value = result.verificationCode || '123456';
        showAuthScreen('verifyScreen');
    } catch (error) {
        showAlert('registerAlert', error.message);
    }
}

async function login() {
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;

    if (!email || !password) {
        showAlert('loginAlert', 'Please fill in all fields');
        return;
    }

    try {
        const result = await apiCall('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password })
        });

        if (result.needsVerification) {
            showAlert('loginAlert', 'Please verify your email first');
            showAuthScreen('verifyScreen');
            return;
        }

        // CLEAR PREVIOUS STATE
        allPasswords = []; // Clear the cached passwords
        authToken = result.authToken;
        currentUser = result.user;
        
        // Update UI and show dashboard
        showDashboard();
        
    } catch (error) {
        showAlert('loginAlert', error.message);
    }
}

async function showDashboard() {
    console.log('=== showDashboard started ===');
    
    try {
        // Hide auth, show dashboard
        document.getElementById('authContainer').style.display = 'none';
        document.getElementById('dashboardContainer').style.display = 'block';
        
        // Ensure dashboard view is visible (hide all others)
        Object.values(dashboardViews).forEach(view => {
            if (view) {
                view.classList.add('hidden');
                view.style.display = 'none';
            }
        });
        // Show dashboard view
        const dashboardView = document.getElementById('dashboardView');
        if (dashboardView) {
            dashboardView.classList.remove('hidden');
            dashboardView.style.display = 'block';
        }
        
        // Update user info
        document.getElementById('userName').textContent = currentUser.name;
        document.getElementById('userAvatar').src = `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUser.name)}&background=4361ee&color=fff`;
        
        // Clear any cached passwords from previous session
        allPasswords = [];
        
        // Get the latest plan from database
        try {
            const currentPlan = await getUserPlan();
            currentUser.plan = currentPlan;
            updatePlanUI(currentPlan);
        } catch (error) {
            console.error('Error fetching user plan:', error);
            updatePlanUI(currentUser.plan || 'free');
        }
        
        // Save to localStorage FIRST
        localStorage.setItem('authToken', authToken);
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
        
        console.log('Dashboard setup complete, loading data...');
        
        // Load dashboard stats
        await loadDashboardData();
        
        // Load passwords and update UI immediately
        await loadAndUpdatePasswords();
        
        console.log('=== showDashboard completed ===');
        
    } catch (error) {
        console.error('Error in showDashboard:', error);
        if (error.message.includes('auth') || error.message.includes('401') || error.message.includes('token')) {
            logout();
        }
    }
}

async function loadAndUpdatePasswords() {
    try {
        console.log('Loading passwords from API...');
        const result = await apiCall('/api/passwords');
        allPasswords = result.passwords || [];
        console.log('Passwords loaded:', allPasswords.length);
        
        // Update UI immediately with the loaded passwords
        updatePasswordLists();
        
        // Also update dashboard stats with fresh data
        await loadDashboardData();
        
    } catch (error) {
        console.error('Error loading passwords:', error);
        // Even if there's an error, try to update UI with empty state
        allPasswords = [];
        updatePasswordLists();
    }
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
        // The backend now handles emailing. The frontend just needs to make the request.
        const result = await apiCall('/api/auth/forgot-password', {
            method: 'POST',
            body: JSON.stringify({ email })
        });

        // Show the generic success message from the backend.
        showAlert('forgotPasswordAlert', result.message, 'success');
        
    } catch (error) {
        showAlert('forgotPasswordAlert', error.message);
    }
}

function showChangeEmailModal() {
    document.getElementById('changeEmailStep1').style.display = 'block';
    document.getElementById('changeEmailStep1Btn').style.display = 'block';
    document.getElementById('changeEmailStep2').style.display = 'none';
    document.getElementById('changeEmailStep2Btn').style.display = 'none';
    document.getElementById('newEmail').value = '';
    document.getElementById('changeEmailPassword').value = '';
    document.getElementById('changeEmailCode').value = '';
    document.getElementById('changeEmailAlert').style.display = 'none';
    showModal('changeEmailModal');
}

async function requestEmailChange() {
    const newEmail = document.getElementById('newEmail').value;
    const password = document.getElementById('changeEmailPassword').value;

    if (!newEmail || !password) {
        showAlert('changeEmailAlert', 'Please fill in all fields');
        return;
    }

    try {
        const result = await apiCall('/api/auth/change-email', {
            method: 'POST',
            body: JSON.stringify({ newEmail, password })
        });

        showAlert('changeEmailAlert', result.message, 'success');

        // Switch to step 2
        document.getElementById('newEmailDisplay').textContent = newEmail;
        document.getElementById('changeEmailStep1').style.display = 'none';
        document.getElementById('changeEmailStep1Btn').style.display = 'none';
        document.getElementById('changeEmailStep2').style.display = 'block';
        document.getElementById('changeEmailStep2Btn').style.display = 'block';

    } catch (error) {
        showAlert('changeEmailAlert', error.message);
    }
}

// [NEW] Change Email logic function
async function verifyEmailChange() {
    const newEmail = document.getElementById('newEmail').value; // We need this from the previous step
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
        
        // For security, log the user out after 3 seconds. The modal will close automatically.
        setTimeout(() => {
            logout(true); // Pass true to indicate a tab close
        }, 3000);

    } catch (error) {
        showAlert('changeEmailAlert', error.message);
    }
}

async function resetPassword() {
    const newPassword = document.getElementById('resetPassword').value;
    const confirmPassword = document.getElementById('resetPasswordConfirm').value;
    
    // The token is now stored globally by the DOMContentLoaded listener
    const token = window.passwordResetToken;

    if (!token) {
        showAlert('resetPasswordAlert', 'Invalid or missing reset token. Please use the link from your email again.');
        return;
    }

    if (!newPassword || !confirmPassword) {
        showAlert('resetPasswordAlert', 'Please fill in all fields');
        return;
    }

    if (newPassword !== confirmPassword) {
        showAlert('resetPasswordAlert', 'Passwords do not match');
        return;
    }

    try {
        const result = await apiCall('/api/auth/reset-password', {
            method: 'POST',
            body: JSON.stringify({ token, newPassword })
        });

        showAlert('resetPasswordAlert', 'Password reset successfully! You can now log in.', 'success');
        
        // Clean up the global token
        window.passwordResetToken = null;
        
        // Remove the token from the URL so it can't be reused
        history.pushState({}, document.title, window.location.pathname);
        
        setTimeout(() => {
            showAuthScreen('loginScreen');
        }, 3000);

    } catch (error) {
        showAlert('resetPasswordAlert', error.message);
    }
}


async function logout(closeTab = false) {
    try {
        // Only attempt to call the API if a token exists.
        if (authToken) {
        // Call the new server endpoint to invalidate the token.
        await apiCall('/api/auth/logout', {
            method: 'POST'
            // No body is needed; the token is sent in the Authorization header.
        });
        }
    } catch (error) {
        // If the API call fails (e.g., the user is offline), we log it
        // but continue the logout process on the client side.
        console.error('Server-side logout failed, proceeding with client-side cleanup:', error);
    } finally {
        // This 'finally' block GUARANTEES that the user is always logged out
        // from the browser, even if the server call fails.
        currentUser = null;
        authToken = null;
        localStorage.removeItem('authToken');
        localStorage.removeItem('currentUser');
        
        if (closeTab) {
            // This is used for security after an email change.
            window.close();
            // Fallback for browsers that block window.close().
            window.location.href = '/'; 
        } else {
            // Normal logout redirect.
            window.location.href = '/';
        }
    }
}

// Dashboard Functions
async function loadDashboardData() {
    try {
        const result = await apiCall('/api/dashboard/stats');
        const stats = result.stats;

        // Update dashboard cards
        document.getElementById('totalPasswords').textContent = stats.total;
        document.getElementById('weakPasswords').textContent = stats.weak;
        document.getElementById('totalCategories').textContent = stats.categories;
        
        // Calculate security score
        const securityScore = stats.total > 0 ? Math.round(((stats.total - stats.weak) / stats.total) * 100) : 100;
        document.getElementById('securityScore').textContent = securityScore + '%';
        document.getElementById('securityStatus').textContent = 
            securityScore >= 80 ? 'Excellent' : 
            securityScore >= 60 ? 'Good' : 'Needs Improvement';

    } catch (error) {
        console.error('Error loading dashboard data:', error);
    }
}

async function loadRecentPasswords() {
    console.log('Starting loadRecentPasswords...');
    
    try {
        // Wait for the elements to be ready
        const loading = await waitForElement('recentPasswordsLoading').catch(() => null);
        const list = await waitForElement('recentPasswordsList').catch(() => null);

        if (!loading || !list) {
            console.warn('Password elements not found, skipping password load');
            return;
        }

        console.log('Elements found, loading passwords...');
        loading.style.display = 'block';
        list.innerHTML = '';

        const result = await apiCall('/api/passwords');
        allPasswords = result.passwords || [];
        
        loading.style.display = 'none';

        if (allPasswords.length === 0) {
            list.innerHTML = `
                <div class="empty-state">
                <i class="fas fa-key"></i>
                <h3>No passwords yet</h3>
                <p>Add your first password to get started</p>
                </div>
            `;
            return;
        }

        // Show only recent 5 passwords
        const recentPasswords = allPasswords.slice(0, 5);
        recentPasswords.forEach(password => {
            const item = createPasswordItem(password);
            list.appendChild(item);
        });

        console.log('Passwords loaded successfully:', allPasswords.length);

    } catch (error) {
        console.error('Error in loadRecentPasswords:', error);
        
        // Safely hide loading if it exists
        const loading = document.getElementById('recentPasswordsLoading');
        if (loading) loading.style.display = 'none';
        
        // Don't logout on DOM errors, just log them
        if (!error.message.includes('Element') && !error.message.includes('null')) {
            // Only logout on actual auth errors
            if (error.message.includes('401') || error.message.includes('authenticated')) {
                logout();
            }
        }
    }
}

async function loadAllPasswords() {
    const loading = document.getElementById('allPasswordsLoading');
    const list = document.getElementById('allPasswordsList');

    loading.style.display = 'block';
    list.innerHTML = '';

    try {
        const result = await apiCall('/api/passwords');
        
        // CLEAR AND REFRESH THE CACHE
        allPasswords = result.passwords || []; // Always replace, don't append
        
        loading.style.display = 'none';

        if (allPasswords.length === 0) {
            list.innerHTML = `
                <div class="empty-state">
                <i class="fas fa-key"></i>
                <h3>No passwords yet</h3>
                <p>Add your first password to get started</p>
                </div>
            `;
            return;
        }

        allPasswords.forEach(password => {
            const item = createPasswordItem(password);
            list.appendChild(item);
        });

    } catch (error) {
        loading.style.display = 'none';
        console.error('Error loading passwords:', error);
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

    // Add share button listener if available
    const shareBtn = item.querySelector('.share-password');
    if (shareBtn) {
        shareBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            showSharePasswordModal(password.id);
        });
    }

    // Add share to vault button listener if available
    const shareToVaultBtn = item.querySelector('.share-to-vault');
    if (shareToVaultBtn) {
        shareToVaultBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            showShareToFamilyVaultModal(password.id);
        });
    }

    return item;
}

 function updatePasswordLists() {
    // Update Recent Passwords list (This part is unchanged)
    if (document.getElementById('dashboardView').style.display !== 'none') {
        const recentList = document.getElementById('recentPasswordsList');
        const recentPasswords = allPasswords.slice(0, 5);
        
        recentList.innerHTML = '';
        if (recentPasswords.length === 0) {
            recentList.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-key"></i>
                    <h3>No passwords yet</h3>
                    <p>Add your first password to get started</p>
                </div>
            `;
        } else {
            recentPasswords.forEach(password => {
                const item = createPasswordItem(password);
                recentList.appendChild(item);
            });
        }
    }

    // Update All Passwords list (This part is MODIFIED)
     if (document.getElementById('passwordsView').style.display !== 'none') {
        // [NEW] Reset the custom dropdown to "All Categories"
        const selectedText = document.getElementById('selectedCategoryText');
        if (selectedText) {
            selectedText.textContent = 'All Categories';
        }
        
        // Reset the "selected" class from all options
        document.querySelectorAll('.dropdown-option').forEach(opt => {
            opt.classList.remove('selected');
        });
        document.querySelector('.dropdown-option[data-value="all"]').classList.add('selected');


        const allList = document.getElementById('allPasswordsList');
        allList.innerHTML = '';
        if (allPasswords.length === 0) {
            allList.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-key"></i>
                    <h3>No passwords yet</h3>
                    <p>Add your first password to get started</p>
                </div>
            `;
        } else {
            allPasswords.forEach(password => {
                const item = createPasswordItem(password);
                allList.appendChild(item);
            });
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
    const currentView = document.querySelector('#dashboardView').style.display !== 'none' ? 
                    'recentPasswordsList' : 'allPasswordsList';
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

// Password Management
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

// Password strength indicator
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

    if (!website || !username || !password) {
        showNotification('Please fill in all required fields', 'error');
        return;
    }

    try {
        await apiCall('/api/passwords', {
            method: 'POST',
            body: JSON.stringify({
                website,
                username,
                password,
                category,
                url,
                notes
            })
        });

        closeModal('addPasswordModal');
        
        // Clear the form
        document.getElementById('passwordWebsite').value = '';
        document.getElementById('passwordUsername').value = '';
        document.getElementById('passwordValue').value = '';
        document.getElementById('passwordCategory').value = 'Personal';
        document.getElementById('passwordUrl').value = '';
        document.getElementById('passwordNotes').value = '';
        
        // USE OUR NEW APPROACH - Load and update passwords
        await loadAndUpdatePasswords();
        
        showNotification('Password saved successfully!');
        
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

const password = result.password;

document.getElementById('passwordDetailsTitle').textContent = password.website;
document.getElementById('detailWebsite').textContent = password.website;
document.getElementById('detailUsername').textContent = password.username;
document.getElementById('detailPassword').value = password.password;
document.getElementById('detailCategory').textContent = password.category;
document.getElementById('detailUrl').textContent = password.url || 'N/A';
document.getElementById('detailNotes').textContent = password.notes || 'No notes';

// Show shared by information
document.getElementById('sharedPasswordInfo').style.display = 'block';
document.getElementById('detailSharedBy').textContent = password.shared_by || 'Unknown';

showModal('passwordDetailsModal');
    } catch (error) {
throw new Error('Failed to load shared password details');
    }
}

async function copySharedPasswordWithPin(shareId, pin) {
    try {
const result = await apiCall(`/api/shared-passwords/${shareId}/view`, {
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

showNotification('Password copied to clipboard! It will be cleared in 30 seconds.');
    } catch (error) {
throw new Error('Failed to copy shared password');
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
            // Use shared password endpoint
            result = await apiCall(`/api/shared-passwords/${passwordId}/view`, {
                method: 'POST',
                body: JSON.stringify({ pin })
            });
        } else {
            // Use regular password endpoint
            result = await apiCall(`/api/passwords/${passwordId}/view`, {
                method: 'POST',
                body: JSON.stringify({ pin })
            });
        }

        const password = result.password;

        document.getElementById('passwordDetailsTitle').textContent = password.website;
        document.getElementById('detailWebsite').textContent = password.website;
        document.getElementById('detailUsername').textContent = password.username;
        document.getElementById('detailPassword').value = password.password;
        document.getElementById('detailCategory').textContent = password.category;
        document.getElementById('detailUrl').textContent = password.url || 'N/A';
        document.getElementById('detailNotes').textContent = password.notes || 'No notes';

        // Show shared by information if it's a shared password
        if (password.is_shared || password.shared_by) {
            document.getElementById('sharedPasswordInfo').style.display = 'block';
            document.getElementById('detailSharedBy').textContent = password.shared_by || 'Unknown';
        } else {
            document.getElementById('sharedPasswordInfo').style.display = 'none';
        }

        showModal('passwordDetailsModal');
    } catch (error) {
        throw new Error('Failed to load password details');
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
    
    // Reset PIN modal to default view
    document.getElementById('pinModalTitle').textContent = 'Enter PIN to Copy Password';
    document.getElementById('pinModalDescription').textContent = 'For security reasons, please enter your PIN to copy this password.';
    setupPinInputs();
    showModal('pinModal');
}

async function copyPasswordWithPin(passwordId, pin) {
    try {
        let result;
        
        if (isSharedPassword) {
            // Use shared password endpoint
            result = await apiCall(`/api/shared-passwords/${passwordId}/view`, {
                method: 'POST',
                body: JSON.stringify({ pin })
            });
        } else {
            // Use regular password endpoint
            result = await apiCall(`/api/passwords/${passwordId}/view`, {
                method: 'POST',
                body: JSON.stringify({ pin })
            });
        }
        
        const passwordText = result.password.password;
        
        // Use modern clipboard API
        await navigator.clipboard.writeText(passwordText);
        
        // Clear clipboard after 30 seconds for security
        setTimeout(async () => {
            try {
                await navigator.clipboard.writeText('');
            } catch (e) {
                // Ignore clipboard clearing errors
            }
        }, 30000);
        
        showNotification('Password copied to clipboard! It will be cleared in 30 seconds.');
    } catch (error) {
        throw new Error('Failed to copy password');
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

        // USE OUR NEW APPROACH - Load and update passwords
        await loadAndUpdatePasswords();
        
        showNotification('Password deleted successfully!');
        
    } catch (error) {
        showNotification('Error deleting password: ' + error.message, 'error');
    }
}

// Family Vault Functions
function showAddFamilyVaultModal() {
    document.getElementById('familyVaultWebsite').value = '';
    document.getElementById('familyVaultUsername').value = '';
    document.getElementById('familyVaultPassword').value = '';
    document.getElementById('familyVaultShareWith').value = 'all';
    document.getElementById('familyVaultCategory').value = 'Entertainment';
    document.getElementById('familyVaultUrl').value = '';
    document.getElementById('familyVaultNotes').value = '';
    document.getElementById('familyVaultPasswordStrength').className = 'security-strength';
    
    // Load family members for specific sharing
    loadFamilyMembersForSharing();
    showModal('addFamilyVaultModal');
}

function showShareToFamilyVaultModal(passwordId) {
    currentPasswordForSharing = passwordId;
    document.getElementById('shareToFamilyVaultWith').value = 'all';
    
    // Load family members for specific sharing
    loadFamilyMembersForSharing('share');
    showModal('shareToFamilyVaultModal');
}

async function loadFamilyMembersForSharing(type = 'add') {
    try {
        const result = await apiCall('/api/family/vault/members');
        const members = result.members || [];
        
        const selectElement = document.getElementById(
            type === 'add' ? 'familyVaultSpecificMember' : 'shareToFamilyVaultSpecificMember'
        );
        const groupElement = document.getElementById(
            type === 'add' ? 'specificMemberGroup' : 'shareSpecificMemberGroup'
        );
        
        selectElement.innerHTML = '<option value="">Select a family member</option>';
        members.forEach(member => {
            const option = document.createElement('option');
            option.value = member.id;
            option.textContent = `${member.name} (${member.role})`;
            selectElement.appendChild(option);
        });
        
        // Show/hide specific member group based on share type selection
        const shareWithElement = document.getElementById(
            type === 'add' ? 'familyVaultShareWith' : 'shareToFamilyVaultWith'
        );
        
        shareWithElement.addEventListener('change', function() {
            groupElement.style.display = this.value === 'specific' ? 'block' : 'none';
        });
        
    } catch (error) {
        console.error('Error loading family members:', error);
    }
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

    // Close the add modal first
    closeModal('addFamilyVaultModal');
    
    // Then show PIN verification modal for adding to family vault
    document.getElementById('pinModalTitle').textContent = 'Enter PIN to Add to Family Vault';
    document.getElementById('pinModalDescription').textContent = 'For security reasons, please enter your PIN to add this password to the family vault.';
    currentAction = 'add_family_vault';
    setupPinInputs();
    showModal('pinModal');
    
    // Store the data for after PIN verification
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
// Update the shareToFamilyVault function to require PIN
async function shareToFamilyVault() {
    const shareWith = document.getElementById('shareToFamilyVaultWith').value;
    const specificMember = document.getElementById('shareToFamilyVaultSpecificMember').value;

    if (!currentPasswordForSharing) {
showNotification('No password selected for sharing', 'error');
return;
    }

    const finalShareWith = shareWith === 'specific' ? specificMember : shareWith;

    if (shareWith === 'specific' && !specificMember) {
showNotification('Please select a family member', 'error');
return;
    }

    // Close the share modal first
    closeModal('shareToFamilyVaultModal');
    
    // Then show PIN verification modal for family sharing
    document.getElementById('pinModalTitle').textContent = 'Enter PIN to Share to Family Vault';
    document.getElementById('pinModalDescription').textContent = 'For security reasons, please enter your PIN to share this password to the family vault.';
    currentAction = 'share_family_vault';
    setupPinInputs();
    showModal('pinModal');
    
    // Store the sharing data for after PIN verification
    window.pendingFamilyShare = {
passwordId: currentPasswordForSharing,
shareWith: finalShareWith
    };
}

// Update the addToFamilyVault function to require PIN
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

    // Close the add modal first
    closeModal('addFamilyVaultModal');
    
    // Then show PIN verification modal for adding to family vault
    document.getElementById('pinModalTitle').textContent = 'Enter PIN to Add to Family Vault';
    document.getElementById('pinModalDescription').textContent = 'For security reasons, please enter your PIN to add this password to the family vault.';
    currentAction = 'add_family_vault';
    setupPinInputs();
    showModal('pinModal');
    
    // Store the data for after PIN verification
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

// New function to handle family vault sharing after PIN verification
async function completeFamilyVaultSharingWithPin(pin) {
    try {
if (!window.pendingFamilyShare) {
    throw new Error('No pending family share data');
}

const { passwordId, shareWith } = window.pendingFamilyShare;

const result = await apiCall(`/api/passwords/${passwordId}/share-to-family`, {
    method: 'POST',
    body: JSON.stringify({
        shareWith: shareWith,
        pin: pin
    })
});

showNotification('Password shared to family vault successfully!');

// Refresh the family sharing view
loadFamilySharingContent(currentUser.plan);

    } catch (error) {
showNotification('Error sharing to family vault: ' + error.message, 'error');
// Optionally, you could reopen the share modal here if you want the user to try again
showModal('shareToFamilyVaultModal');
    }
}

// New function to handle adding to family vault after PIN verification
async function completeFamilyVaultAddWithPin(pin) {
    try {
if (!window.pendingFamilyAdd) {
    throw new Error('No pending family add data');
}

const { website, username, password, shareWith, category, url, notes } = window.pendingFamilyAdd;

const result = await apiCall('/api/family/vault/passwords', {
    method: 'POST',
    body: JSON.stringify({
        website,
        username,
        password,
        shareWith,
        category,
        url,
        notes,
        pin: pin
    })
});

showNotification('Password added to family vault successfully!');

// Refresh the family sharing view
loadFamilySharingContent(currentUser.plan);

    } catch (error) {
showNotification('Error adding to family vault: ' + error.message, 'error');
// Optionally, you could reopen the add modal here if you want the user to try again
showModal('addFamilyVaultModal');
    }
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

        const password = result.password;

        document.getElementById('passwordDetailsTitle').textContent = `${password.website} (Family Vault)`;
        document.getElementById('detailWebsite').textContent = password.website;
        document.getElementById('detailUsername').textContent = password.username;
        document.getElementById('detailPassword').value = password.password;
        document.getElementById('detailCategory').textContent = password.category;
        document.getElementById('detailUrl').textContent = password.url || 'N/A';
        document.getElementById('detailNotes').textContent = password.notes || 'No notes';

        // Show family vault specific info
        document.getElementById('sharedPasswordInfo').style.display = 'block';
        document.getElementById('detailSharedBy').textContent = `Added by: ${password.added_by_name}`;

        showModal('passwordDetailsModal');
    } catch (error) {
        throw new Error('Failed to load family vault password details');
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
        throw new Error('Failed to copy family vault password');
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
        
        // Refresh the family sharing view
        loadFamilySharingContent(currentUser.plan);
        
    } catch (error) {
        showNotification('Error removing from family vault: ' + error.message, 'error');
    }
}

// Sharing functions
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

    // Close the share modal first
    closeModal('sharePasswordModal');
    
    // Then show PIN verification modal
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
// Verify the PIN first
const verifyResult = await apiCall('/api/auth/verify-pin', {
    method: 'POST',
    body: JSON.stringify({ pin })
});

if (!verifyResult.success) {
    throw new Error('Invalid PIN');
}

// PIN is valid, now show the share password modal
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
        
        // Refresh the sharing center view
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
            <ul style="padding-left: 20px; margin: 0;">
                <li>Full access to all family passwords</li>
                <li>Can invite and manage family members</li>
                <li>Can enable emergency access</li>
            </ul>
        `;
    } else {
        permissionsDiv.innerHTML = `
            <ul style="padding-left: 20px; margin: 0;">
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
        
        // Refresh the family sharing view
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
        
        // Refresh the family sharing view
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

    // First verify the password by attempting to login
    await apiCall('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
email: currentUser.email,
password: password
      })
    });

    // Delete the family group
    const result = await apiCall('/api/family', {
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

        // First verify the password by attempting to login
        await apiCall('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({
                email: currentUser.email,
                password: password
            })
        });

        // Now call the DELETE endpoint - no request body needed
        // The auth token in the header identifies the user
        const result = await apiCall('/api/auth/delete-account', {
            method: 'DELETE'
            // No body needed - backend uses auth token to identify user
        });

        // Reset button state
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
    try {
const email = document.getElementById('shareEmail').value;
const accessLevel = document.getElementById('shareAccessLevel').value;
const expiresInHours = document.getElementById('shareExpires').value;

const result = await apiCall(`/api/passwords/${currentPasswordForSharing}/share`, {
    method: 'POST',
    headers: { 'X-PIN-Verification': pin },
    body: JSON.stringify({
        email,
        accessLevel,
        expiresInHours: expiresInHours ? parseInt(expiresInHours) : null
    })
});

if (result.requiresSignup) {
    showNotification('Invitation sent. User will be able to accept after signing up.');
} else {
    showNotification(`Password shared successfully with ${result.sharedWith}`);
}
loadSharingCenterContent(currentUser.plan);
    } catch (error) {
showNotification('Error sharing password: ' + error.message, 'error');
showModal('sharePasswordModal');
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
const result = await apiCall(`/api/passwords/${currentPasswordForSharing}/share-qr`, {
    method: 'POST',
    headers: { 'X-PIN-Verification': pin }
});

const qrContainer = document.getElementById('qrCodeContainer');
qrContainer.innerHTML = '';

const qr = qrcode(0, 'L');
qr.addData(result.token);
qr.make();
qrContainer.innerHTML = qr.createImgTag(6, 8); // ( cellSize, margin )

showModal('qrCodeModal');
    } catch (error) {
showNotification(`Error generating QR code: ${error.message}`, 'error');
throw error; // Re-throw to inform verifyPin
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

async function acceptQrShare(token) {
    try {
const result = await apiCall('/api/shared-passwords/accept-qr', {
    method: 'POST',
    body: JSON.stringify({ token })
});
showNotification(result.message, 'success');
// Refresh sharing view to show the new item
loadSharingCenterContent(currentUser.plan);
    } catch (error) {
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
    
    // --- URL and Session Handling Logic ---
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
        showDashboard();
    } else {
        // 3. If nothing else, show the default login screen.
        console.log("No session found. Showing login screen.");
        showAuthScreen('loginScreen');
    }

    const dropdown = document.getElementById('categoryDropdown');
    const selected = dropdown.querySelector('.dropdown-selected');
    const options = dropdown.querySelectorAll('.dropdown-option');
    const selectedText = document.getElementById('selectedCategoryText');

    // 1. Toggle dropdown open/close
    selected.addEventListener('click', () => {
        dropdown.classList.toggle('open');
    });

    // 2. Handle option selection
    options.forEach(option => {
        option.addEventListener('click', () => {
            // Update the displayed text
            selectedText.textContent = option.textContent;
            
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

    // Event delegation for data-action attributes (replaces inline onclick handlers)
    document.addEventListener('click', function(e) {
        const target = e.target.closest('[data-action]');
        if (!target) return;
        
        const action = target.getAttribute('data-action');
        const arg = target.getAttribute('data-arg');
        
        // Map actions to functions
        const actionMap = {
            'togglePassword': () => togglePassword(arg),
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
            'exportActivityLog': () => exportActivityLog(),
            'clearActivityLog': () => clearActivityLog(),
            'upgradePlan': () => upgradePlan(arg),
            'cancelSubscription': () => cancelSubscription(arg),
            'logout': () => logout()
        };
        
        if (actionMap[action]) {
            e.preventDefault();
            actionMap[action]();
        }
    });

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
if (!window.pendingFamilyShare) {
    throw new Error('No pending family share data');
}

const { passwordId, shareWith } = window.pendingFamilyShare;

const result = await apiCall(`/api/passwords/${passwordId}/share-to-family`, {
    method: 'POST',
    body: JSON.stringify({
        shareWith: shareWith,
        pin: pin
    })
});

showNotification('Password shared to family vault successfully!');

// Refresh the family sharing view
loadFamilySharingContent(currentUser.plan);

    } catch (error) {
showNotification('Error sharing to family vault: ' + error.message, 'error');
// Optionally, you could reopen the share modal here if you want the user to try again
showModal('shareToFamilyVaultModal');
    }
}

// New function to handle adding to family vault after PIN verification
async function completeFamilyVaultAddWithPin(pin) {
    try {
if (!window.pendingFamilyAdd) {
    throw new Error('No pending family add data');
}

const { website, username, password, shareWith, category, url, notes } = window.pendingFamilyAdd;

const result = await apiCall('/api/family/vault/passwords', {
    method: 'POST',
    body: JSON.stringify({
        website,
        username,
        password,
        shareWith,
        category,
        url,
        notes,
        pin: pin
    })
});

showNotification('Password added to family vault successfully!');

// Refresh the family sharing view
loadFamilySharingContent(currentUser.plan);

    } catch (error) {
showNotification('Error adding to family vault: ' + error.message, 'error');
// Optionally, you could reopen the add modal here if you want the user to try again
showModal('addFamilyVaultModal');
    }
}

    function getFlagUrl(countryCode) {
    if (!countryCode || countryCode.length !== 2 || countryCode === 'XX') {
        return null; // Return null if the country is unknown
    }
    // Request a 40px wide image instead of 20px for high-DPI displays.
    return `https://flagcdn.com/w40/${countryCode.toLowerCase()}.png`;
}