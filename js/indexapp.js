// Check for authentication tokens and redirect if found
        document.addEventListener('DOMContentLoaded', function() {
            const loadingScreen = document.getElementById('loadingScreen');
            const landingPage = document.getElementById('landingPage');
            const getStartedBtn = document.getElementById('getStartedBtn');
            const finalCtaBtn = document.getElementById('finalCtaBtn');

            // --- THIS IS THE NEW, CORRECTED LOGIC ---

            const urlParams = new URLSearchParams(window.location.search);
            // 1. Look for the password reset token from the email link.
            const resetToken = urlParams.get('reset_token');

            if (resetToken) {
                // If a reset token is found, this user needs to go to the main app to reset their password.
                // We immediately redirect them, passing the token along in the URL.
                console.log('Password reset token found, redirecting to the main application...');
                window.location.href = `eazypasswords.html?reset_token=${resetToken}`;
                
                // We return here to stop any further code from running on this page.
                // The loading screen will remain until the redirect happens.
                return; 
            }

            // 2. If no reset token, check for a normal login session.
            const authToken = localStorage.getItem('authToken');
            const sessionToken = sessionStorage.getItem('authToken');

            if (authToken || sessionToken) {
                // If a user is already logged in, send them straight to the main app.
                console.log('Authentication token found, redirecting to app...');
                window.location.href = 'eazypasswords.html';
                return;
            } 
            
            // 3. If no reset token AND no login session, show the landing page.
            console.log('No tokens found, showing landing page.');
            setTimeout(() => {
                loadingScreen.classList.add('hidden');
                landingPage.style.display = 'block';
            }, 500); // A short delay to prevent flashing.

            // --- End of new logic ---


            // Set up button click handlers (no changes here)
            getStartedBtn.addEventListener('click', function(e) {
                e.preventDefault();
                window.location.href = 'eazypasswords.html';
            });
            
            finalCtaBtn.addEventListener('click', function(e) {
                e.preventDefault();
                window.location.href = 'eazypasswords.html';
            });
            
            // Initially hide the landing page while checking auth (no changes here)
            landingPage.style.display = 'none';
        });