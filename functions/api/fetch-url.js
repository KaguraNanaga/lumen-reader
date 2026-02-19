export async function onRequestPost(context) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  try {
    const { url } = await context.request.json();

    if (!url || typeof url !== 'string') {
      return Response.json({ error: 'Missing url field' }, { status: 400, headers: corsHeaders });
    }

    // Basic URL validation
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return Response.json({ error: 'Invalid URL' }, { status: 400, headers: corsHeaders });
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return Response.json({ error: 'Only HTTP/HTTPS URLs are supported' }, { status: 400, headers: corsHeaders });
    }

    // Fetch the page
    let html;
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Lumen/1.0; +https://lumen-atj-4t6.pages.dev)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
        },
        redirect: 'follow',
        cf: { cacheTtl: 300 },
      });

      if (!res.ok) {
        return Response.json(
          { error: `Failed to fetch URL (HTTP ${res.status})` },
          { status: 502, headers: corsHeaders }
        );
      }

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
        return Response.json(
          { error: 'URL does not point to an HTML page' },
          { status: 400, headers: corsHeaders }
        );
      }

      html = await res.text();
    } catch (err) {
      return Response.json(
        { error: 'Could not reach URL: ' + (err.message || 'network error') },
        { status: 502, headers: corsHeaders }
      );
    }

    // Extract text from HTML
    const title = extractTitle(html);
    const text = extractArticleText(html);

    if (!text || text.length < 50) {
      return Response.json(
        { error: 'Could not extract meaningful text from this page' },
        { status: 422, headers: corsHeaders }
      );
    }

    return Response.json(
      { title, text, source_url: url },
      { headers: corsHeaders }
    );
  } catch (err) {
    return Response.json(
      { error: 'Server error: ' + (err.message || 'unknown') },
      { status: 500, headers: corsHeaders }
    );
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

// --- Text extraction helpers ---

function extractTitle(html) {
  // Try <title> tag
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) return decodeEntities(titleMatch[1]).trim();
  // Try og:title
  const ogMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (ogMatch) return decodeEntities(ogMatch[1]).trim();
  return '';
}

function extractArticleText(html) {
  // Remove unwanted sections
  let cleaned = html;

  // Remove script, style, nav, header, footer, aside, form, noscript
  cleaned = cleaned.replace(/<(script|style|noscript|nav|header|footer|aside|form|svg|iframe|button)[\s\S]*?<\/\1>/gi, ' ');

  // Remove HTML comments
  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '');

  // Try to find article content by common selectors
  const articleText = extractByTag(cleaned, 'article')
    || extractByAttr(cleaned, 'role', 'article')
    || extractByClass(cleaned, 'article-content')
    || extractByClass(cleaned, 'post-content')
    || extractByClass(cleaned, 'entry-content')
    || extractByClass(cleaned, 'article-body')
    || extractByClass(cleaned, 'story-body')
    || extractByTag(cleaned, 'main');

  if (articleText && articleText.length > 200) {
    return cleanExtractedText(articleText);
  }

  // Fallback: extract from body
  const bodyMatch = cleaned.match(/<body[\s\S]*?>([\s\S]*)<\/body>/i);
  const bodyHtml = bodyMatch ? bodyMatch[1] : cleaned;
  return cleanExtractedText(stripTags(bodyHtml));
}

function extractByTag(html, tag) {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = html.match(regex);
  return match ? stripTags(match[1]) : null;
}

function extractByAttr(html, attr, value) {
  // Match element with specific attribute value
  const regex = new RegExp(`<[a-z][a-z0-9]*[^>]+${attr}=["']${value}["'][^>]*>([\\s\\S]*?)(?=<\\/[a-z])`, 'i');
  const match = html.match(regex);
  return match ? stripTags(match[1]) : null;
}

function extractByClass(html, className) {
  // Match element with specific class
  const regex = new RegExp(`<[a-z][a-z0-9]*[^>]+class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)(?=<\\/[a-z])`, 'i');
  const match = html.match(regex);
  if (!match) return null;
  // Try to get more content after the opening tag
  const startIdx = html.indexOf(match[0]);
  if (startIdx === -1) return stripTags(match[1]);
  // Simple: take up to 100k chars after match start
  const chunk = html.slice(startIdx, startIdx + 100000);
  return stripTags(chunk);
}

function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ');
}

function decodeEntities(str) {
  return str
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function cleanExtractedText(text) {
  let cleaned = decodeEntities(text);
  // Collapse whitespace
  cleaned = cleaned.replace(/[ \t]+/g, ' ');
  // Collapse excessive newlines
  cleaned = cleaned.replace(/\n\s*\n\s*\n/g, '\n\n');
  // Trim lines
  cleaned = cleaned.split('\n').map(l => l.trim()).join('\n');
  // Remove leading/trailing whitespace
  cleaned = cleaned.trim();
  // Truncate
  if (cleaned.length > 50000) {
    cleaned = cleaned.slice(0, 50000) + '\n\n[Text truncated]';
  }
  return cleaned;
}
