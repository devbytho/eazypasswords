document.addEventListener('DOMContentLoaded', function() {

    const loadingScreen = document.getElementById('loadingScreen');
    const landingPage = document.getElementById('landingPage');
    

    const modal = document.getElementById("privacyModal");
    const privacyBtn = document.getElementById("privacyLink");
    const span = document.querySelector(".policy-close");
    const closeBtn = document.getElementById("closePolicyBtn");


    const urlParams = new URLSearchParams(window.location.search);
    const resetToken = urlParams.get('reset_token');

    if (resetToken) {
        console.log('Password reset token found, redirecting...');
        window.location.href = `eazypasswords.html?reset_token=${resetToken}`;
        return; 
    }


    const authToken = localStorage.getItem('authToken');
    const encryptionKey = localStorage.getItem('ep_session_key');

    if (authToken && encryptionKey) {
        console.log('Valid session found. Redirecting to app...');
        window.location.href = 'eazypasswords.html';
        return;
    } 
    

    if (authToken && !encryptionKey) {
        localStorage.removeItem('authToken');
        localStorage.removeItem('currentUser');
    }

-
    setTimeout(() => {
        if (loadingScreen) loadingScreen.classList.add('hidden');
        if (landingPage) landingPage.style.display = 'block';
    }, 100);


    const navButtons = document.querySelectorAll('.nav-btn');
    navButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            window.location.href = 'eazypasswords.html';
        });
    });

    if (privacyBtn) {
        privacyBtn.onclick = function(e) {
            e.preventDefault();
            if (modal) {
                modal.style.display = "block";
                document.body.style.overflow = "hidden";
            }
        }
    }

    function closeModal() {
        if (modal) {
            modal.style.display = "none";
            document.body.style.overflow = "auto"; 
        }
    }

    if (span) span.onclick = closeModal;
    if (closeBtn) closeBtn.onclick = closeModal;

    window.onclick = function(event) {
        if (modal && event.target == modal) {
            closeModal();
        }
    }
});