console.log('Using locale:', userLocale);
const headersEl = document.getElementById('messageHeaders');
const bodyEl = document.getElementById('messageBody');
const actionBar = document.getElementById('actionBar');
const loadingEl = document.getElementById('loadingIndicator');
const calendarInviteSection = document.getElementById('calendarInviteSection');
let currentMessage = null;
let currentShowImages = false;
let lastJiraSearchResultSummary = '';

document.getElementById('btnPrint').addEventListener('click', showPrintPreview);
document.getElementById('btnClosePrint').addEventListener('click', () => {
    document.getElementById('printOverlay').classList.add('hidden');
});
document.getElementById('btnConfirmPrint').addEventListener('click', () => {
    const iframe = document.getElementById('printIframe');
    if (iframe && iframe.srcdoc) {
        vscode.postMessage({ type: 'print', html: iframe.srcdoc });
    }
});

function showPrintPreview() {
    if (!currentMessage) return;
    const overlay = document.getElementById('printOverlay');
    overlay.classList.remove('hidden');
    
    const iframe = document.getElementById('printIframe');
    
    let headersHtml = '<div style="font-family: sans-serif; padding: 16px 0 0 0; color: #000; font-size: 14px;">';
    headersHtml += '<div style="margin-bottom: 4px;"><strong>From:</strong> ' + escapeHtml(currentMessage.fromDisplay) + '</div>';
    headersHtml += '<div style="margin-bottom: 4px;"><strong>Date:</strong> ' + formatDate(currentMessage.date) + '</div>';
    headersHtml += '<div style="margin-bottom: 4px;"><strong>To:</strong> ' + escapeHtml(currentMessage.toDisplay) + '</div>';
    if (currentMessage.ccDisplay) {
        headersHtml += '<div style="margin-bottom: 4px;"><strong>Cc:</strong> ' + escapeHtml(currentMessage.ccDisplay) + '</div>';
    }
    headersHtml += '<div style="margin-bottom: 4px;"><strong>Subject:</strong> ' + escapeHtml(currentMessage.subject || '(no subject)') + '</div>';
    headersHtml += '<hr style="margin: 20px 0; border: 0; border-top: 1px solid #ccc;">';
    headersHtml += '</div>';

    const result = renderMessageContent(currentMessage, currentShowImages);
    let rawBodyHtml = result.html;
    
    if (rawBodyHtml.match(/<body[^>]*>/i)) {
        rawBodyHtml = rawBodyHtml.replace(/(<body[^>]*>)/i, '$1' + headersHtml);
    } else {
        rawBodyHtml = headersHtml + rawBodyHtml;
    }
    
    const printStyle = '<style>@media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }</style>';
    if (rawBodyHtml.includes('</head>')) {
        rawBodyHtml = rawBodyHtml.replace('</head>', printStyle + '</head>');
    } else {
        rawBodyHtml = printStyle + rawBodyHtml;
    }
    
    iframe.srcdoc = rawBodyHtml;
}

document.getElementById('btnReply').addEventListener('click', () => {
    vscode.postMessage({ type: 'reply', showImages: currentShowImages });
});
document.getElementById('btnReplyAll').addEventListener('click', () => {
    vscode.postMessage({ type: 'replyAll', showImages: currentShowImages });
});
document.getElementById('btnForward').addEventListener('click', () => {
    vscode.postMessage({ type: 'forward', showImages: currentShowImages });
});
document.getElementById('btnInbox').addEventListener('click', () => vscode.postMessage({ type: 'inbox' }));
document.getElementById('btnArchive').addEventListener('click', () => vscode.postMessage({ type: 'archive' }));
document.getElementById('btnSpam').addEventListener('click', () => vscode.postMessage({ type: 'spam' }));
document.getElementById('btnNewsletters').addEventListener('click', () => vscode.postMessage({ type: 'newsletters' }));
document.getElementById('btnTrash').addEventListener('click', () => vscode.postMessage({ type: 'trash' }));
document.getElementById('btnDelete').addEventListener('click', () => vscode.postMessage({ type: 'delete' }));

customFolders.forEach((cf, i) => {
    const btn = document.getElementById('btnCustom_' + i);
    if (btn) {
        btn.addEventListener('click', () => {
            vscode.postMessage({ type: 'moveCustom', target: cf.path });
        });
    }
});

// Jira Modal Logic
const jiraModal = document.getElementById('jiraModalOverlay');
const jiraInput = document.getElementById('jiraIssueInput');
const jiraStatus = document.getElementById('jiraStatus');
const btnJiraPairText = document.getElementById('btnJiraPairText');
const jiraSearchFallback = document.getElementById('jiraSearchFallback');
const jiraSearchQueryInput = document.getElementById('jiraSearchQueryInput');

const btnJiraCommentStart = document.getElementById('btnJiraCommentStart');
const jiraCommentSection = document.getElementById('jiraCommentSection');
const jiraSearchSection = document.getElementById('jiraSearchSection');
const jiraCommentEditor = document.getElementById('jiraCommentEditor');
const jiraCommentStatus = document.getElementById('jiraCommentStatus');

const updateCommentButtonVisibility = () => {
     const val = jiraInput.value.trim();
     const isPaired = currentMessage && currentMessage.pairedJiraIssue && currentMessage.pairedJiraIssue === val;
     if (isPaired) {
         btnJiraCommentStart.classList.remove('hidden');
     } else {
         btnJiraCommentStart.classList.add('hidden');
     }
};

jiraInput.addEventListener('input', updateCommentButtonVisibility);

document.getElementById('btnJiraPair').addEventListener('click', () => {
    jiraModal.classList.remove('hidden');
    jiraCommentSection.classList.add('hidden');
    jiraSearchSection.classList.remove('hidden');
    jiraInput.value = (currentMessage && currentMessage.pairedJiraIssue) ? currentMessage.pairedJiraIssue : '';
    jiraStatus.innerHTML = '';
    lastJiraSearchResultSummary = '';
    
    updateCommentButtonVisibility();

    if (currentMessage && currentMessage.pairedJiraIssueSummary) {
        jiraSearchQueryInput.value = currentMessage.pairedJiraIssueSummary;
    } else if (currentMessage && currentMessage.subject) {
        const cleanSubject = currentMessage.subject.replace(/^((Re|Fw|Fwd):\s*)+/i, '').replace(/[+\-&|!(){}[\]^~*?:\/"\\]/g, ' ').replace(/\s+/g, ' ').trim();
        jiraSearchQueryInput.value = cleanSubject;
    } else {
        jiraSearchQueryInput.value = '';
    }
    jiraInput.focus();
});

document.getElementById('btnJiraCloseModal').addEventListener('click', () => {
    jiraModal.classList.add('hidden');
});

// Comment functionality
document.getElementById('btnJiraCommentStart').addEventListener('click', () => {
    jiraSearchSection.classList.add('hidden');
    jiraCommentSection.classList.remove('hidden');
    jiraCommentStatus.innerHTML = '';
    if (currentMessage) {
        let commentHtml = '<strong>From:</strong> ' + escapeHtml(currentMessage.fromDisplay) + '<br>';
        commentHtml += '<strong>To:</strong> ' + escapeHtml(currentMessage.toDisplay) + '<br>';
        if (currentMessage.ccDisplay) {
            commentHtml += '<strong>Cc:</strong> ' + escapeHtml(currentMessage.ccDisplay) + '<br>';
        }
        commentHtml += '<strong>Subject:</strong> ' + escapeHtml(currentMessage.subject || '(no subject)') + '<br>';
        commentHtml += '<strong>Date:</strong> ' + formatDate(currentMessage.date) + '<br>';
        commentHtml += '<br>';
        let bodyContent = '';
        if (currentMessage.text) {
            let bodyText = currentMessage.text;
            // Split globally to robustly strip out original message separators even if quoted
            bodyText = bodyText.split(/(?:^|\n)[ \t>]*[-_]{2,}[ \t]*(?:original|forwarded|původní|puvodni|přeposlaná|preposlana)?[ \t]*(?:message|zpráva|zprava)[ \t]*[-_]{2,}/i)[0];
            
            let lines = bodyText.split(/\r?\n/);
            let outLines = [];
            for(let i = 0; i < lines.length; i++) {
                let l = lines[i].trim();
                // Strip common English and Czech reply headers
                if (
                    l.match(/^(>|\s)*(On|Dne)\s.*(wrote|napsal\(a\)|napsal):$/i) ||
                    l.match(/^(>|\s)*(original|forwarded|původní|puvodni|přeposlaná|preposlana)?[ \t]*(message|zpráva|zprava):\s*$/i) ||
                    l.match(/^(>|\s)*_{10,}$/) ||
                    (l.match(/^(>|\s)*(From|Od):\s/i) && i > 0 && lines[i-1].trim() === '')
                ) {
                    break;
                }
                outLines.push(lines[i]);
            }
            bodyContent = escapeHtml(outLines.join('\n').trim()).replace(/\n/g, '<br>');
        } else if (currentMessage.html) {
            // Fallback to stripping the first blockquote if only HTML is available
            bodyContent = currentMessage.html.split(/<blockquote/i)[0];
            // Also split by custom separator used in our WYSIWYG Sent emails
            bodyContent = bodyContent.split(/(?:<p[^>]*>|<div[^>]*>|<br>|\s)*[-_]{2,}[ \t]*(?:original|forwarded|původní|puvodni|přeposlaná|preposlana)?[ \t]*(?:message|zpráva|zprava)[ \t]*[-_]{2,}/i)[0];
        }
        commentHtml += bodyContent;
        jiraCommentEditor.innerHTML = commentHtml;
    }
});

document.getElementById('btnJiraCommentCancel').addEventListener('click', () => {
    jiraCommentSection.classList.add('hidden');
    jiraSearchSection.classList.remove('hidden');
});

document.getElementById('btnJiraCommentSend').addEventListener('click', () => {
    const commentText = jiraCommentEditor.innerText.trim();
    const issueKey = jiraInput.value.trim();
    if (!commentText || !issueKey) return;
    jiraCommentStatus.innerHTML = '<span class="loader" style="width:12px; height:12px; border-width: 2px;"></span> Sending...';
    vscode.postMessage({ type: 'jiraComment', issueKey: issueKey, comment: commentText });
});

// Search trigger functionality
const doSearch = () => {
    const query = jiraSearchQueryInput.value.trim();
    if (!query) return;
    jiraStatus.innerHTML = '<span class="loader" style="width:12px; height:12px; border-width: 2px;"></span> Searching...';
    vscode.postMessage({ type: 'jiraSearch', subject: query });
};
document.getElementById('btnJiraSearchCustom').addEventListener('click', doSearch);
jiraSearchQueryInput.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') doSearch();
});

// Save trigger functionality
const doSave = () => {
    const val = jiraInput.value.trim();
    if (currentMessage) {
         if (val) {
             const summaryToSave = lastJiraSearchResultSummary || jiraSearchQueryInput.value.trim();
             vscode.postMessage({ type: 'jiraPair', subject: currentMessage.subject, issueKey: val, summary: summaryToSave });
             btnJiraPairText.innerText = '#' + val;
             currentMessage.pairedJiraIssue = val;
             currentMessage.pairedJiraIssueSummary = summaryToSave;
             jiraStatus.innerHTML = '<span style="color:var(--vscode-testing-iconPassed);">Saved successfully.</span>';
         } else {
             // Clear the pairing
             vscode.postMessage({ type: 'jiraPair', subject: currentMessage.subject, issueKey: '', summary: '' });
             btnJiraPairText.innerText = 'JIRA';
             currentMessage.pairedJiraIssue = '';
             currentMessage.pairedJiraIssueSummary = '';
             jiraStatus.innerHTML = '<span style="color:var(--vscode-testing-iconPassed);">Pairing cleared.</span>';
         }
         updateCommentButtonVisibility();
    }
};
document.getElementById('btnJiraSave').addEventListener('click', doSave);
jiraInput.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') doSave();
});

// Show/Hide buttons based on current folder
window.addEventListener('message', event => {
    const msg = event.data;
    if (msg.type === 'message') {
        renderMessageView(msg.message);

        const settings = msg.message.folderSettings || {};
        const current = msg.message.currentResidesIn;
        
        const btnInbox = document.getElementById('btnInbox');
        const btnArchive = document.getElementById('btnArchive');
        const btnSpam = document.getElementById('btnSpam');
        const btnNewsletters = document.getElementById('btnNewsletters');
        const btnTrash = document.getElementById('btnTrash');
        const btnDelete = document.getElementById('btnDelete');
        
        if (btnInbox) {
            if (current.toUpperCase() === 'INBOX' || current === settings.inbox) {
                btnInbox.classList.add('hidden');
            } else {
                btnInbox.classList.remove('hidden');
            }
        }
        
        if (btnArchive) {
            if (current === settings.archive) {
                btnArchive.classList.add('hidden');
            } else {
                btnArchive.classList.remove('hidden');
            }
        }

        if (btnSpam) {
            if (current === settings.spam) {
                btnSpam.classList.add('hidden');
            } else {
                btnSpam.classList.remove('hidden');
            }
        }

        if (btnNewsletters) {
            if (current === settings.newsletters) {
                btnNewsletters.classList.add('hidden');
            } else {
                btnNewsletters.classList.remove('hidden');
            }
        }
        
        if (btnTrash && btnDelete) {
            if (current === settings.trash) {
                btnTrash.classList.add('hidden');
                btnDelete.classList.remove('hidden');
            } else {
                btnTrash.classList.remove('hidden');
                btnDelete.classList.add('hidden');
            }
        }

        if (msg.message.pairedJiraIssue) {
            btnJiraPairText.innerText = '#' + msg.message.pairedJiraIssue;
        } else {
            btnJiraPairText.innerText = 'JIRA';
        }

        const btnJiraPair = document.getElementById('btnJiraPair');
        if (btnJiraPair) {
            if (msg.message.hasJira) {
                btnJiraPair.classList.remove('hidden');
            } else {
                btnJiraPair.classList.add('hidden');
            }
        }

        customFolders.forEach((cf, i) => {
            const btn = document.getElementById('btnCustom_' + i);
            if (btn) {
                if (current === cf.path) {
                    btn.classList.add('hidden');
                } else {
                    btn.classList.remove('hidden');
                }
            }
        });
    }
});

const btnBack = document.getElementById('btnBack');
if (btnBack) {
    btnBack.addEventListener('click', () => {
        vscode.postMessage({ type: 'back' });
    });
}

function renderMessageView(msg, showImages = false) {
     currentMessage = msg;
     currentShowImages = showImages;
     loadingEl.classList.add('hidden');
     
     // Render everything into bodyEl (which is in the DOM, so getElementById works)
     // Create warning element dynamically if not present, and place above bodyEl
     let warningEl = document.getElementById('messageWarning');
     if (!warningEl) {
         warningEl = document.createElement('div');
         warningEl.id = 'messageWarning';
         bodyEl.parentNode.insertBefore(warningEl, bodyEl);
     }
     renderMessage(bodyEl, msg, showImages, '_main', false, true, warningEl);
     
    // Render calendar invite if present
    renderCalendarInvite(msg);

    // Extract headers + attachments from bodyEl and move to headersEl
     headersEl.innerHTML = '';
     const headers = bodyEl.querySelector('.message-headers');
     const attachments = bodyEl.querySelector('.attachments');
     if (headers) headersEl.appendChild(headers);
     if (attachments) headersEl.appendChild(attachments);
     
     // Show action bar
     actionBar.classList.remove('hidden');
     const msgBtns = document.getElementById('messageButtons');
     if (msgBtns) {
         msgBtns.classList.remove('hidden');
     }
     
    // Re-bind listener for show images
      bodyEl.addEventListener('requestShowImages', (e) => {
        const message = e.detail.message;
        renderMessageView(message, true);
      });

      bodyEl.addEventListener('requestWhitelistSender', (e) => {
        const message = e.detail.message;
        vscode.postMessage({ type: 'whitelistSender', sender: message.from.address });
      });

    // Attachment buttons
    document.querySelectorAll('.attachment-chip').forEach(btn => {
        btn.addEventListener('click', () => {
           const filename = decodeURIComponent(btn.dataset.filename);
           downloadAttachment(filename);
        });
    });

    // Contact buttons
    document.querySelectorAll('.add-contact-link').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            const contact = this.dataset.contact;
            if (contact) {
                vscode.postMessage({ type: 'addContact', contact: contact });
                this.style.display = 'none';
            }
        });
    });
}

window.addEventListener('message', (event) => {
    const msg = event.data;
    switch (msg.type) {
        case 'jiraSearchResult':
            if (msg.issues && msg.issues.length > 0) {
                let infoHtml = '<div style="display:flex; flex-direction:column; gap:6px;">';
                msg.issues.forEach((issue, index) => {
                    let itemHtml = '<div><strong>Found Issue:</strong> <a href="#" class="jira-issue-link" data-key="' + escapeHtml(issue.key) + '" data-summary="' + escapeHtml(issue.summary || '') + '" style="color:var(--vscode-textLink-foreground); text-decoration:none;">' + escapeHtml(issue.key) + '</a>';
                    if (issue.summary) itemHtml += ' - ' + escapeHtml(issue.summary);
                    if (issue.statusName) itemHtml += '<br><strong>Status:</strong> ' + escapeHtml(issue.statusName);
                    if (issue.created) {
                        const d = new Date(issue.created);
                        itemHtml += ' | <strong>Created:</strong> ' + d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
                    }
                    itemHtml += '</div>';
                    infoHtml += itemHtml;
                });
                infoHtml += '</div>';
                jiraStatus.innerHTML = infoHtml;
                
                // Add click listeners to the dynamically created links
                const links = jiraStatus.querySelectorAll('.jira-issue-link');
                links.forEach(link => {
                    link.addEventListener('click', (e) => {
                        e.preventDefault();
                        jiraInput.value = link.getAttribute('data-key');
                        lastJiraSearchResultSummary = link.getAttribute('data-summary');
                        // highlight briefly or provide feedback? Just focusing is fine for now
                        jiraInput.focus();
                    });
                });
            } else {
                jiraStatus.innerText = 'Not found';
            }
            break;
        case 'jiraCommentResult':
            if (msg.success) {
                jiraCommentSection.classList.add('hidden');
                jiraSearchSection.classList.remove('hidden');
                jiraCommentStatus.innerHTML = '';
            } else {
                jiraCommentStatus.innerHTML = '<span style="color:var(--vscode-errorForeground);">Failed to send comment.</span>';
            }
            break;
        case 'loading':
            headersEl.innerHTML = '';
            bodyEl.innerHTML = '';
            calendarInviteSection.classList.add('hidden');
            if (!isEmbedded) {
                actionBar.classList.add('hidden');
            }
            const mb = document.getElementById('messageButtons');
            if (mb) mb.classList.add('hidden');
            
            loadingEl.classList.remove('hidden');
            const loadingText = msg.text || 'Loading message...';
            loadingEl.innerHTML = '<span class="loader"></span>' + escapeHtml(loadingText);
            break;
        case 'contactAdded':
            if (currentMessage) {
                 if (!currentMessage.contacts) currentMessage.contacts = [];
                 if (msg.contacts) {
                     currentMessage.contacts = msg.contacts;
                 } else {
                     currentMessage.contacts.push(msg.contact);
                 }
            }
            break;
        case 'messageMoved':
            headersEl.innerHTML = '';
            bodyEl.innerHTML = '<div class="empty-msg">Moved to ' + escapeHtml(msg.target) + '.</div>';
            if (!isEmbedded) {
                actionBar.classList.add('hidden');
            }
            if (document.getElementById('messageButtons')) document.getElementById('messageButtons').classList.add('hidden');
            loadingEl.classList.add('hidden');
            break;
        case 'messageDeleted':
            headersEl.innerHTML = '';
            bodyEl.innerHTML = '<div class="empty-msg">Message deleted.</div>';
            if (!isEmbedded) {
                actionBar.classList.add('hidden');
            }
            if (document.getElementById('messageButtons')) document.getElementById('messageButtons').classList.add('hidden');
            loadingEl.classList.add('hidden');
            break;
        case 'message':
            console.log('Received message data', msg);
            try {
                currentMessage = msg.message;
                renderMessageView(msg.message, false);
                console.log('Message rendered successfully');
            } catch (e) {
                console.error('Render error', e);
                bodyEl.innerHTML = '<div class="error-msg">Render Error: ' + (e instanceof Error ? e.message : String(e)) + '</div>';
            }
            break;
        case 'error':
            loadingEl.classList.add('hidden');
            if (!isEmbedded) {
                actionBar.classList.add('hidden');
            }
            const mbe = document.getElementById('messageButtons');
            if (mbe) mbe.classList.add('hidden');

            bodyEl.innerHTML = '<div class="error-msg">Error: ' + escapeHtml(msg.message) + '</div>';
            break;
    }
});

function downloadAttachment(filename) {
    vscode.postMessage({ type: 'downloadAttachment', filename: filename });
}

// ---- Calendar Invite Logic ----

function renderCalendarInvite(msg) {
    if (!msg.calendarInvite || !msg.calendarInvite.uid) {
        calendarInviteSection.classList.add('hidden');
        return;
    }

    const invite = msg.calendarInvite;

    // Method label
    const methodEl = document.getElementById('calendarMethod');
    const methodLabels = { REQUEST: 'Meeting Invitation', CANCEL: 'Meeting Cancelled', REPLY: 'Meeting Response', PUBLISH: 'Event' };
    methodEl.textContent = methodLabels[invite.method] || invite.method || 'Calendar Event';

    // Summary
    const summaryEl = document.getElementById('calendarSummary');
    summaryEl.textContent = invite.summary || '(no title)';

    // Date/time
    const startRow = document.getElementById('calendarStartRow');
    const datetimeEl = document.getElementById('calendarDatetime');
    if (invite.start) {
        let dtStr = formatCalendarDate(invite.start);
        if (invite.end) {
            const endStr = formatCalendarDate(invite.end);
            // Only show end date if different from start date
            const startDay = invite.start.slice(0, 10);
            const endDay = invite.end.slice(0, 10);
            if (startDay === endDay) {
                // Same day: show time range
                const endTime = formatCalendarTime(invite.end);
                if (endTime) dtStr += ' – ' + endTime;
            } else {
                dtStr += ' – ' + endStr;
            }
        }
        datetimeEl.textContent = dtStr;
        startRow.classList.remove('hidden');
    } else {
        startRow.classList.add('hidden');
    }

    // Location
    const locationRow = document.getElementById('calendarLocationRow');
    const locationEl = document.getElementById('calendarLocation');
    if (invite.location) {
        locationEl.textContent = invite.location;
        locationRow.classList.remove('hidden');
    } else {
        locationRow.classList.add('hidden');
    }

    // Organizer
    const organizerRow = document.getElementById('calendarOrganizerRow');
    const organizerEl = document.getElementById('calendarOrganizer');
    if (invite.organizer) {
        organizerEl.textContent = invite.organizer;
        organizerRow.classList.remove('hidden');
    } else {
        organizerRow.classList.add('hidden');
    }

    // Attendees
    const attendeesRow = document.getElementById('calendarAttendeesRow');
    const attendeesEl = document.getElementById('calendarAttendees');
    if (invite.attendees && invite.attendees.length > 0) {
        attendeesEl.textContent = invite.attendees.join(', ');
        attendeesRow.classList.remove('hidden');
    } else {
        attendeesRow.classList.add('hidden');
    }

    calendarInviteSection.classList.remove('hidden');
}

function formatCalendarDate(iso) {
    try {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return iso;
        // Date-only (no T)
        if (!iso.includes('T')) {
            return d.toLocaleDateString(userLocale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        }
        return d.toLocaleString(userLocale, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return iso; }
}

function formatCalendarTime(iso) {
    try {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        if (!iso.includes('T')) return '';
        return d.toLocaleTimeString(userLocale, { hour: '2-digit', minute: '2-digit' });
    } catch { return ''; }
}
