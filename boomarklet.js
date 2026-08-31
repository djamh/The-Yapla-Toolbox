javascript:(()=>{const existing=document.querySelector('script[data-yapla-toolbox-launcher="true"]');if(existing)existing.remove();const s=document.createElement("script");s.src="https://YOUR-USERNAME.github.io/yapla-toolbox/toolbox.js?_="+Date.now();s.dataset.yaplaToolboxLauncher="true";s.onerror=()=>alert("Unable to load Yapla Toolbox.");document.head.appendChild(s);})();

