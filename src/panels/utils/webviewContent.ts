import * as vscode from 'vscode';

export function getSharedStyles(nonce: string): string {
    return /* css */ `
        /* Message headers */
        .message-headers {
            padding: 16px;
            border-bottom: 1px solid var(--vscode-widget-border);
            background: var(--vscode-editor-background);
        }
        .header-subject {
            font-size: 1.3em;
            font-weight: 600;
            margin-bottom: 12px;
            color: var(--vscode-editor-foreground);
        }
        .header-row {
            display: grid;
            grid-template-columns: 60px 1fr;
            margin-bottom: 4px;
            font-size: 0.95em;
        }
        .header-label {
            color: var(--vscode-descriptionForeground);
            font-weight: 500;
        }
        .header-value {
            word-break: break-word;
            color: var(--vscode-editor-foreground);
        }
        .header-date {
            color: var(--vscode-descriptionForeground);
            font-size: 0.9em;
            margin-top: 8px;
        }

        /* Attachments */
        .attachments {
            padding: 10px 16px;
            border-bottom: 1px solid var(--vscode-widget-border);
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
        }
        .attachment-chip {
            display: flex;
            align-items: center;
            gap: 4px;
            padding: 4px 10px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: 1px solid var(--vscode-button-border);
            border-radius: 12px;
            font-size: 0.85em;
            cursor: pointer;
            text-decoration: none;
        }
        .attachment-chip:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        /* Message body iframe */
        .message-body-iframe {
            width: calc(100% - 32px);
            min-width: calc(100% - 32px);
            margin: 16px;
            border: none;
            display: block;
            background-color: #ffffff;
            /* Height and potentially width will be set by JS */
        }

        /* External Images Warning */
        .images-blocked-warning {
            display: flex;
            align-items: center;
            justify-content: space-between;
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            color: var(--vscode-editor-foreground);
            padding: 0;
            padding-left: 12px;
            margin-bottom: 16px;
            border-radius: 4px;
            font-size: 0.9em;
            border-left: 4px solid var(--vscode-notificationsWarningIcon-foreground);
            margin: 16px; 
            overflow: hidden;
            height: 36px;
        }
        .images-blocked-warning > div {
            display: flex;
            height: 100%;
        }
        .images-blocked-warning button {
            background: transparent;
            color: var(--vscode-foreground);
            border: none;
            border-left: 1px solid var(--vscode-widget-border);
            padding: 0 14px;
            border-radius: 0;
            cursor: pointer;
            height: 100%;
            font-family: var(--vscode-font-family);
        }
        .images-blocked-warning button:hover {
            background: #ff9800 !important;
            color: #ffffff !important;
        }

        /* For Compose Context - Quoted Header style overrides or additions if needed */
        .quoted-message-container {
             margin-top: 20px;
             border-top: 2px solid var(--vscode-widget-border);
        }
        .quoted-message-title {
            padding: 16px 0 10px 0;
            color: #000000;
            background: transparent;
        }

        /* Loading Spinner */
        .loader {
            width: 18px;
            height: 18px;
            border: 2px solid var(--vscode-descriptionForeground);
            border-bottom-color: transparent;
            border-radius: 50%;
            display: inline-block;
            box-sizing: border-box;
            animation: rotation 1s linear infinite;
            vertical-align: middle;
            margin-right: 8px;
        }

        @keyframes rotation {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    `;
}

export function getSharedScripts(nonce: string, userLocale: string): string {
    return /* javascript */ `
        const userLocale = '${userLocale}';

        function formatDate(isoStr) {
            const d = new Date(isoStr);
            return d.toLocaleDateString(userLocale, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
                + ' ' + d.toLocaleTimeString(userLocale, { hour: '2-digit', minute: '2-digit' });
        }

        function escapeHtml(str) {
            if (!str) return '';
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        }

        // Returns { html, hasBlockedImages }
        function renderMessageContent(msg, showImages) {
             // Prepare iframe content first to determine if we have blocked images
            let bodyContent = '';
            let hasBlockedImages = false;

            // Define resize script content
            const resizeScriptContent = 
                '    console.log("Iframe script running");' +
                '    window.onerror = function(msg, url, line) {' +
                '        console.error("Iframe script error:", msg, url, line);' +
                '        window.parent.postMessage({ type: "error", message: "Iframe script error: " + msg }, "*");' +
                '    };' +
                '    function sendResize() {' +
                '        const wrapper = document.getElementById("resizer-wrapper");' +
                '        const height = Math.max(document.body.scrollHeight, document.body.offsetHeight, document.documentElement.scrollHeight, document.documentElement.offsetHeight);' +
                '        const width = wrapper ? wrapper.offsetWidth : document.body.scrollWidth;' +
                '        window.parent.postMessage({ type: "resize", height: height + 20, width: width, source: window.name }, "*");' +
                '    }' +
                '    const resizeObserver = new ResizeObserver(entries => sendResize());' +
                '    if(document.body) resizeObserver.observe(document.body);' +
                '    if(document.documentElement) resizeObserver.observe(document.documentElement);' +
                '    window.addEventListener("load", sendResize);' +
                '    sendResize();' +
                '    document.addEventListener("click", function(e) {' +
                '        const a = e.target.closest("a");' +
                '        if (a && a.href && (a.href.startsWith("http://") || a.href.startsWith("https://"))) {' +
                '            e.preventDefault();' +
                '            window.parent.postMessage({ type: "openExternal", url: a.href }, "*");' +
                '        }' +
                '    });';

            if (msg.html) {
                // Parse and process HTML for external images
                const parser = new DOMParser();
                const doc = parser.parseFromString(msg.html, 'text/html');
                
                // Security: Remove all script tags from the email body
                doc.querySelectorAll('script').forEach(s => s.remove());

                const images = doc.querySelectorAll('img');
                
                images.forEach(img => {
                    const src = img.getAttribute('src');
                    if (src && (src.startsWith('http://') || src.startsWith('https://'))) {
                        if (!showImages && (!msg.isWhitelisted || msg.isSpam)) {
                            img.setAttribute('data-original-src', src);
                            img.removeAttribute('src');
                            img.style.border = '1px dashed #ccc';
                            img.style.padding = '10px';
                            img.setAttribute('alt', '[Image Blocked]');
                            hasBlockedImages = true;
                        }
                    }
                });

                // Ensure links open in external browser
                const links = doc.querySelectorAll('a');
                links.forEach(link => {
                    link.setAttribute('target', '_blank');
                });
                
                bodyContent = doc.body ? '<div id="resizer-wrapper" style="display: table; min-width: 100%;">' + doc.body.innerHTML + '</div>' : '';
                 
                 // Add base styles
                 const style = doc.createElement('style');
                 style.textContent = 
                    'body {' +
                    '    background-color: #ffffff;' +
                    '    color: #000000;' +
                    '    margin: 0;' +
                    '    padding: 16px;' +
                    '    font-family: sans-serif;' +
                    '}' +
                    'pre { white-space: pre-wrap; word-break: break-word; }';

                 if (doc.head) {
                     const meta = doc.createElement('meta');
                     meta.setAttribute('http-equiv', 'Content-Security-Policy');
                     meta.setAttribute('content', "default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src * data:; font-src * data:;");
                     doc.head.insertBefore(meta, doc.head.firstChild);
                     doc.head.appendChild(style);
                 } else {
                     bodyContent = "<head><meta http-equiv='Content-Security-Policy' content=\\\"default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src * data:; font-src * data:;\\\"></head>" +
                                   '<style>' + style.textContent + '</style>' + bodyContent;
                 }
                
                 bodyContent = doc.documentElement.innerHTML;

                 const scriptTags = '<script nonce="${nonce}">' + resizeScriptContent + '<' + '/script>';
                 if (bodyContent.includes('</body>')) {
                     bodyContent = bodyContent.replace('</body>', scriptTags + '</body>');
                 } else {
                     bodyContent += scriptTags;
                 }
            } else if (msg.text) {
                bodyContent = 
                '<head>' +
                '    <meta http-equiv="Content-Security-Policy" content="default-src \\\'none\\\'; style-src \\\'unsafe-inline\\\'; script-src \\\'nonce-${nonce}\\\'; img-src * data:; font-src * data:;">' +
                '    <style>' +
                '        body {' +
                '            background-color: #ffffff;' +
                '            color: #000000;' +
                '            margin: 0;' +
                '            padding: 16px;' +
                '            font-family: monospace;' +
                '            white-space: pre-wrap;' +
                '            word-break: break-word;' +
                '        }' +
                '    </style>' +
                '</head>' +
                '<body><div id="resizer-wrapper" style="display: table; min-width: 100%;">' + escapeHtml(msg.text) + '</div>' + 
                '<script nonce="${nonce}">' + resizeScriptContent + '<\\/script>' +
                '</body>';
            } else {
                 bodyContent = 
                '<head>' +
                '    <meta http-equiv="Content-Security-Policy" content="default-src \\\'none\\\'; style-src \\\'unsafe-inline\\\'; script-src \\\'nonce-${nonce}\\\'; img-src * data:; font-src * data:;">' +
                '    <style>' +
                '        body {' +
                '            background-color: #ffffff;' +
                '            color: #666;' +
                '            padding: 16px;' +
                '            font-family: sans-serif;' +
                '        }' +
                '    </style>' +
                '</head>' +
                '<body><div id="resizer-wrapper" style="display: table; min-width: 100%;">No content available.</div>' + 
                '<script nonce="${nonce}">' + resizeScriptContent + '<\\/script>' +
                '</body>';
            }

            return { html: bodyContent, hasBlockedImages };
        }

        /**
         * Renders the message into the given container.
         * @param {HTMLElement} container The container to render into.
         * @param {object} msg The message object (IMailMessageDetail).
         * @param {boolean} showImages Whether to show external images.
         * @param {string} iframeNameUniqueSuffix A suffix for the iframe name/id to avoid collisions if multiple are present.
         * @returns {HTMLIFrameElement} The created iframe element.
         */
        function renderMessage(container, msg, showImages = false, iframeNameUniqueSuffix = '', skipHeaders = false) {
            let html = '';
            if (!skipHeaders) {
            html += '<div class="message-headers">';
            html += '<div class="header-subject">' + escapeHtml(msg.subject) + '</div>';
            html += '<div class="header-row"><span class="header-label">From:</span><span class="header-value">' + escapeHtml(msg.fromDisplay) + '</span></div>';
            html += '<div class="header-row"><span class="header-label">To:</span><span class="header-value">' + escapeHtml(msg.toDisplay) + '</span></div>';
            if (msg.ccDisplay) {
                html += '<div class="header-row"><span class="header-label">CC:</span><span class="header-value">' + escapeHtml(msg.ccDisplay) + '</span></div>';
            }
            html += '<div class="header-date">' + formatDate(msg.date) + '</div>';
            html += '</div>';
            }

            // Attachments
            if (!skipHeaders && msg.attachments && msg.attachments.length > 0) {
                html += '<div class="attachments">';
                for (const att of msg.attachments) {
                    const safeName = escapeHtml(att.filename);
                    const encodedName = encodeURIComponent(att.filename);
                    html += '<button class="attachment-chip" data-filename="' + encodedName + '">📎 ' + safeName + ' ⬇</button>';
                }
                html += '</div>';
            }

            const { html: bodyContent, hasBlockedImages } = renderMessageContent(msg, showImages);

            if (hasBlockedImages) {
                html += '<div class="images-blocked-warning" id="imagesBlockedWarning' + iframeNameUniqueSuffix + '">';
                html += '<span>External images were blocked to protect your privacy.</span>';
                html += '<div>';
                html += '<button id="btnShowImages' + iframeNameUniqueSuffix + '">Show Images</button>';
                html += '<button id="btnWhitelistImages' + iframeNameUniqueSuffix + '">Always load from ' + escapeHtml(msg.from?.address || '') + '</button>';
                html += '</div>';
                html += '</div>';
            }

            const iframeId = 'message-body-iframe' + iframeNameUniqueSuffix;
            html += '<iframe id="' + iframeId + '" name="' + iframeId + '" class="message-body-iframe" scrolling="no" sandbox="allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox"></iframe>';

            container.innerHTML = html;

            const iframe = document.getElementById(iframeId);
            const fullIframeContent = '<!DOCTYPE html><html>' + bodyContent + '</html>';
            if(iframe) {
                iframe.srcdoc = fullIframeContent;
            }

            if (hasBlockedImages) {
                document.getElementById('btnShowImages' + iframeNameUniqueSuffix).addEventListener('click', () => {
                   // Request re-render via a callback or event if we were in a class, 
                   // but here we might need to handle it outside or add a callback param.
                   // For now, simpler to dispatch a custom event on the container.
                   const event = new CustomEvent('requestShowImages', { detail: { message: msg } });
                   container.dispatchEvent(event);
                });
                
                const btnWhitelist = document.getElementById('btnWhitelistImages' + iframeNameUniqueSuffix);
                if (btnWhitelist) {
                    btnWhitelist.addEventListener('click', () => {
                        const event = new CustomEvent('requestWhitelistSender', { detail: { message: msg } });
                        container.dispatchEvent(event);
                    });
                }
            }
            
            return iframe;
        }

        // Global resize handler needed only once
        if (!window.resizeHandlerInstalled) {
            window.addEventListener('message', (event) => {
                if (event.data.type === 'resize' && event.data.source) {
                     const iframe = document.getElementsByName(event.data.source)[0];
                     if (iframe) {
                         iframe.style.height = event.data.height + 'px';
                         if (event.data.width) {
                             const containerWidth = iframe.parentElement ? iframe.parentElement.clientWidth : window.innerWidth;
                             if (event.data.width > (containerWidth - 32)) {
                                 iframe.style.width = event.data.width + 'px';
                             } else {
                                 iframe.style.width = 'calc(100% - 32px)';
                             }
                         }
                     }
                } else if (event.data.type === 'openExternal' && event.data.url) {
                    if (typeof vscode !== 'undefined') {
                        vscode.postMessage({ type: 'openExternal', url: event.data.url });
                    }
                }
            });

            window.addEventListener('resize', () => {
                document.querySelectorAll('.message-body-iframe').forEach(iframe => {
                    iframe.style.width = 'calc(100% - 32px)';
                });
            });
            window.resizeHandlerInstalled = true;
        }
    `;
}
