import { ICalendarInvite } from '../types/message';

/**
 * Unfolds iCalendar lines (RFC 5545 section 3.1).
 * Lines folded with CRLF + whitespace are joined into a single logical line.
 */
function unfoldLines(raw: string): string[] {
    return raw
        .replace(/\r\n[ \t]/g, '')
        .replace(/\r\n/g, '\n')
        .replace(/\n[ \t]/g, '')
        .split('\n');
}

/**
 * Extracts the value part of an iCalendar property line.
 * Handles parameter syntax: PROP;PARAM=VAL:value
 */
function extractValue(line: string): string {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) return '';
    return line.slice(colonIdx + 1).trim();
}

/**
 * Returns the property name (before any colon or semicolon).
 */
function extractPropName(line: string): string {
    const semiIdx = line.indexOf(';');
    const colonIdx = line.indexOf(':');
    const end = semiIdx !== -1 && semiIdx < colonIdx ? semiIdx : colonIdx;
    return end !== -1 ? line.slice(0, end).toUpperCase() : line.toUpperCase();
}

/**
 * Parses a DTSTART or DTEND value into an ISO 8601 string.
 * Supports formats: 20231015T090000Z, 20231015T090000, 20231015
 */
function parseDateTime(value: string): string {
    // Strip TZID and VALUE parameters from the property line if present
    // value here is already after the colon
    const v = value.replace(/^.*:/, '').trim();

    if (v.length === 8) {
        // Date-only: YYYYMMDD
        return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
    } else if (v.length >= 15) {
        // DateTime: YYYYMMDDTHHMMSS[Z]
        const year = v.slice(0, 4);
        const month = v.slice(4, 6);
        const day = v.slice(6, 8);
        const hour = v.slice(9, 11);
        const min = v.slice(11, 13);
        const sec = v.slice(13, 15);
        const utc = v.endsWith('Z') ? 'Z' : '';
        return `${year}-${month}-${day}T${hour}:${min}:${sec}${utc}`;
    }
    return v;
}

/**
 * Extracts CN= or email from an organizer/attendee property value.
 * Example: CN=John Doe:MAILTO:john@example.com
 * or: MAILTO:john@example.com
 */
function extractContact(line: string): string {
    const colonIdx = line.indexOf(':');
    const paramPart = colonIdx !== -1 ? line.slice(0, colonIdx) : line;
    const valuePart = colonIdx !== -1 ? line.slice(colonIdx + 1) : '';

    // Try CN=
    const cnMatch = paramPart.match(/CN=([^;:]+)/i);
    if (cnMatch) {
        const cn = cnMatch[1].trim().replace(/^"(.*)"$/, '$1');
        // Also try to get email
        const mailtoMatch = valuePart.match(/MAILTO:(.+)/i);
        if (mailtoMatch) {
            return `${cn} <${mailtoMatch[1].trim()}>`;
        }
        return cn;
    }

    // Fallback: use MAILTO: email
    const mailtoMatch = valuePart.match(/MAILTO:(.+)/i) || line.match(/MAILTO:(.+)/i);
    if (mailtoMatch) {
        return mailtoMatch[1].trim();
    }

    return valuePart || paramPart;
}

/**
 * Parses a raw ICS string and returns the first VEVENT as ICalendarInvite.
 * Returns undefined if no valid VEVENT is found.
 */
export function parseIcs(icsText: string): ICalendarInvite | undefined {
    const lines = unfoldLines(icsText);

    let inVEvent = false;
    let inVCalendar = false;
    let method: string | undefined;

    const event: Partial<ICalendarInvite> & { attendees: string[] } = {
        attendees: [],
    };

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (trimmed.toUpperCase() === 'BEGIN:VCALENDAR') {
            inVCalendar = true;
            continue;
        }
        if (trimmed.toUpperCase() === 'END:VCALENDAR') {
            inVCalendar = false;
            break;
        }

        if (inVCalendar) {
            const propName = extractPropName(trimmed);

            if (propName === 'METHOD') {
                method = extractValue(trimmed).toUpperCase();
                continue;
            }

            if (trimmed.toUpperCase() === 'BEGIN:VEVENT') {
                inVEvent = true;
                continue;
            }
            if (trimmed.toUpperCase() === 'END:VEVENT') {
                inVEvent = false;
                // Only take the first VEVENT
                break;
            }
        }

        if (!inVEvent) continue;

        const propName = extractPropName(trimmed);
        const value = extractValue(trimmed);

        switch (propName) {
            case 'UID':
                event.uid = value;
                break;
            case 'SUMMARY':
                event.summary = value.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';');
                break;
            case 'DESCRIPTION':
                event.description = value.replace(/\\n/g, '\n').replace(/\\,/g, ',');
                break;
            case 'LOCATION':
                event.location = value.replace(/\\n/g, '\n').replace(/\\,/g, ',');
                break;
            case 'DTSTART':
                // Value may contain tzid params: DTSTART;TZID=Europe/Prague:20231015T090000
                event.start = parseDateTime(trimmed.slice(trimmed.indexOf(':') + 1));
                break;
            case 'DTEND':
                event.end = parseDateTime(trimmed.slice(trimmed.indexOf(':') + 1));
                break;
            case 'ORGANIZER': {
                // Line format: ORGANIZER;CN="Name":MAILTO:email@example.com
                const afterOrganizer = trimmed.slice('ORGANIZER'.length);
                event.organizer = extractContact(afterOrganizer);
                break;
            }
            case 'ATTENDEE': {
                const afterAttendee = trimmed.slice('ATTENDEE'.length);
                const contact = extractContact(afterAttendee);
                if (contact) {
                    event.attendees.push(contact);
                }
                break;
            }
        }
    }

    if (!event.uid) {
        return undefined;
    }

    return {
        uid: event.uid,
        method: method,
        summary: event.summary,
        start: event.start,
        end: event.end,
        location: event.location,
        organizer: event.organizer,
        attendees: event.attendees.length > 0 ? event.attendees : undefined,
        description: event.description,
    };
}
