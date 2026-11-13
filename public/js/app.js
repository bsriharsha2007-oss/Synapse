(function () {
  const nativeFetch = window.fetch.bind(window);
  const authPage = window.location.pathname === '/login.html';

  function safeInternalNext(value) {
    if (!value) return '/index.html';
    try {
      const destination = new URL(value, window.location.origin);
      if (destination.origin !== window.location.origin || destination.pathname === '/login.html') {
        return '/index.html';
      }
      return `${destination.pathname}${destination.search}${destination.hash}`;
    } catch (error) {
      return '/index.html';
    }
  }

  window.synapseSafeNext = safeInternalNext;

  window.fetch = async function (...args) {
    const response = await nativeFetch(...args);
    const requestUrl = args[0] instanceof Request ? args[0].url : String(args[0]);
    const isAuthRequest = requestUrl.includes('/api/auth/');
    if (response.status === 401 && !authPage && !isAuthRequest) {
      const next = `${window.location.pathname}${window.location.search}`;
      window.location.replace(`/login.html?next=${encodeURIComponent(next)}`);
    }
    return response;
  };

  if (authPage) {
    nativeFetch('/api/auth/session')
      .then(response => {
        if (!response.ok) throw new Error('Unable to check the current sign-in session.');
        return response.json();
      })
      .then(({ user }) => {
        if (!user) return;
        const next = new URLSearchParams(window.location.search).get('next');
        window.location.replace(safeInternalNext(next));
      })
      .catch(error => console.error('Unable to check the current sign-in session:', error));
    return;
  }

  const navLinks = document.querySelector('.nav-links');
  if (!navLinks) return;

  nativeFetch('/api/me')
    .then(async response => {
      if (!response.ok) return;
      const user = await response.json();
      document.querySelectorAll('a[href="/admin.html"]').forEach(link => {
        link.hidden = user.role !== 'admin';
      });

      const identity = document.createElement('span');
      identity.className = 'nav-user';
      const name = document.createElement('strong');
      name.textContent = user.name;
      identity.append(name, document.createTextNode(` · ${user.role === 'admin' ? 'Admin' : 'Student'}`));
      navLinks.appendChild(identity);

      const logout = document.createElement('button');
      logout.type = 'button';
      logout.className = 'nav-control';
      logout.textContent = 'Sign out';
      logout.addEventListener('click', async () => {
        logout.disabled = true;
        try {
          const response = await nativeFetch('/api/auth/logout', { method: 'POST' });
          if (!response.ok) throw new Error('Unable to sign out. Please try again.');
          window.location.assign('/login.html');
        } catch (error) {
          logout.disabled = false;
          logout.textContent = error.message;
        }
      });
      navLinks.appendChild(logout);
    })
    .catch(error => console.error('Unable to load signed-in user details:', error));
})();
