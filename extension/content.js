"use strict";
// 1. boot / guard

// Injection guard: the background script may inject this file more than
// once, so only initialize once per page.
if (!window.__IMG_CITATION_TOOL_LOADED__) {
  window.__IMG_CITATION_TOOL_LOADED__ = true;

  // 2. url helpers

  function normalizeUrl(url) {
    try {
      return new URL(url, document.baseURI).href;
    } catch {
      return url;
    }
  }

  // comparison helper: ignore query + hash (CDN cache-busters, size params, etc.)
  function normalizeForCompare(url) {
    try {
      const u = new URL(url, document.baseURI);
      return u.origin + u.pathname;
    } catch {
      return url;
    }
  }

  // 3. image matching helpers
  // pull possible URLs from an <img> including common lazy-load patterns
  function getCandidateUrls(img) {
    const urls = [];

    // standard sources
    if (img.currentSrc) urls.push(img.currentSrc);
    if (img.src) urls.push(img.src);

    // common lazy-load attributes
    const lazyAttrs = [
      "data-src",
      "data-original",
      "data-lazy-src",
      "data-url",
      "data-image",
      "data-img",
      "data-source",
      "data-srcset",
    ];

    for (const a of lazyAttrs) {
      const v = img.getAttribute(a);
      if (v) urls.push(v);
    }

    // normalize and de-dupe
    const normalized = urls.map(normalizeUrl).filter(Boolean);
    return Array.from(new Set(normalized));
  }

  function findBestMatchingImage(requestedUrl) {
    const targetExact = normalizeUrl(requestedUrl);
    const targetLoose = normalizeForCompare(requestedUrl);

    const imgs = Array.from(document.images);

    const matches = imgs.filter((img) => {
      const candidates = getCandidateUrls(img);

      return candidates.some((c) => {
        if (c === targetExact) return true;
        if (normalizeForCompare(c) === targetLoose) return true;
        return false;
      });
    });

    if (matches.length === 0) return null;
    if (matches.length === 1) return matches[0];

    // If multiple matches, prefer the one that's "most visible" / largest rendered area
    let best = matches[0];
    let bestArea = 0;

    for (const img of matches) {
      const rect = img.getBoundingClientRect();
      const area = Math.max(0, rect.width) * Math.max(0, rect.height);
      if (area > bestArea) {
        bestArea = area;
        best = img;
      }
    }

    return best;
  }

  // 4. page metadata helpers

  function getCanonicalUrl() {
    const link = document.querySelector('link[rel="canonical"]');
    const href = link?.getAttribute("href") || "";
    return href ? normalizeUrl(href) : "";
  }

  function getFigcaption(imgEl) {
    const fig = imgEl.closest("figure");
    if (!fig) return "";
    const cap = fig.querySelector("figcaption");
    return (cap?.innerText || "").trim();
  }

  function getReferrerPolicy(imgEl) {
    // property is usually fine; fallback to attribute
    return (imgEl.referrerPolicy || imgEl.getAttribute("referrerpolicy") || "").trim();
  }

  // 5. semantic extraction helpers

  /* 5.A page-level semantics:
        hostname
        metaDescription
        ogTitle
        ogDescription
  */
  function getHostname() {
    return window.location.hostname || "";
  }

  function getMetaDescription() {
    return document.querySelector("meta[name='description']")?.content || "";
  }

  function getOgTitle() {
    return document.querySelector("meta[property='og:title']")?.content || "";
  }

  function getOgDescription() {
    return document.querySelector("meta[property='og:description']")?.content || "";
  }

  /* 5.B image-neighborhood semantics
        linkedHref
        linkedText
        nearestHeading
        nearestParagraph
  */

  function cleanText(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  function isProbablyJunkText(text) {
    const t = cleanText(text).toLowerCase();
    if (!t) return true;

    const junkPatterns = [
      "permission details",
      "view in browser",
      "image source",
      "source image",
      "photograph:",
      "advertisement",
      "cookies",
      "privacy policy",
      "terms of use",
      "share",
      "read more"
    ];

    return junkPatterns.some(pattern => t.includes(pattern));
  }

  function isProbablyBadContainer(el) {
    if (!el) return false;

    const badSelectors = [
      "nav",
      "footer",
      "aside",
      "[role='navigation']",
      "[aria-label*='breadcrumb' i]",
      ".navbox",
      ".sidebar",
      ".advert",
      ".advertisement",
      ".ad",
      ".metadata",
      ".license",
      ".licensetpl",
      ".mw-mmv-image-metadata",
      ".mw-mmv-image-links"
    ];

    return badSelectors.some(selector => {
      try {
        return el.matches?.(selector) || el.closest?.(selector);
      } catch {
        return false;
      }
    });
  }

  function getCandidateText(el, maxLength) {
    if (!el || isProbablyBadContainer(el)) return "";

    const text = cleanText(el.innerText || el.textContent || "");
    if (isProbablyJunkText(text)) return "";

    return text.slice(0, maxLength);
  }

  function getLinkedHref(imgEl) {
    const link = imgEl.closest("a[href]");
    if (!link) return "";
    return normalizeUrl(link.getAttribute("href") || "");
  }

  function getLinkedText(imgEl) {
    const link = imgEl.closest("a");
    if (!link) return "";

    // avoid huge blobs of text
    const text = cleanText(link.innerText || link.textContent || "");
    return text.slice(0, 300);
  }

  function isHeading(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    return /^H[1-6]$/.test(el.tagName);
  }

  function getNearestHeading(imgEl) {
    let node = imgEl.parentElement;

    while (node) {
      // 1. closest heading inside current container
      const headingInside = node.querySelector("h1, h2, h3, h4, h5, h6");
      if (headingInside) {
        const text = getCandidateText(headingInside, 300);
        if (text) return text;
      }

      // 2. previous heading siblings while walking upward
      let sibling = node.previousElementSibling;
      while (sibling) {
        if (isHeading(sibling)) {
          const text = getCandidateText(sibling, 300);
          if (text) return text;
        }

        const nestedHeading = sibling.querySelector?.("h1, h2, h3, h4, h5, h6");
        if (nestedHeading) {
          const text = getCandidateText(nestedHeading, 300);
          if (text) return text;
        }

        sibling = sibling.previousElementSibling;
      }

      node = node.parentElement;
    }

    return "";
  }

  function getNearestParagraph(imgEl) {
    let node = imgEl.parentElement;

    while (node) {
      // 1. paragraph inside the same container
      const pInside = node.querySelector("p");
      if (pInside) {
        const text = getCandidateText(pInside, 500);
        if (text) return text;
      }

      // 2. previous sibling paragraphs
      let sibling = node.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === "P") {
          const text = getCandidateText(sibling, 500);
          if (text) return text;
        }

        const nestedP = sibling.querySelector?.("p");
        if (nestedP) {
          const text = getCandidateText(nestedP, 500);
          if (text) return text;
        }

        sibling = sibling.previousElementSibling;
      }

      node = node.parentElement;
    }

    return "";
  }

  // 6. response payload builders
  function buildFailurePayload({ imgUrl, pageUrl, pageTitle, canonicalUrl, error }) {
    return {
      ok: false,
      error,
      pageUrl,
      pageTitle,
      canonicalUrl,
      hostname: getHostname(),
      metaDescription: getMetaDescription(),
      ogTitle: getOgTitle(),
      ogDescription: getOgDescription(),
      imageUrl: normalizeUrl(imgUrl),
    };
  }

  function buildSuccessPayload({ imgEl, imgUrl, pageUrl, pageTitle, canonicalUrl }) {
    return {
      ok: true,
      pageUrl,
      pageTitle,
      canonicalUrl,
      hostname: getHostname(),
      metaDescription: getMetaDescription(),
      ogTitle: getOgTitle(),
      ogDescription: getOgDescription(),

      linkedHref: getLinkedHref(imgEl),
      linkedText: getLinkedText(imgEl),
      nearestHeading: getNearestHeading(imgEl),
      nearestParagraph: getNearestParagraph(imgEl),

      imageUrl: normalizeUrl(imgEl.currentSrc || imgEl.src || imgUrl),
      alt: (imgEl.getAttribute("alt") || "").trim(),
      title: (imgEl.getAttribute("title") || "").trim(),
      ariaLabel: (imgEl.getAttribute("aria-label") || "").trim(),
      caption: getFigcaption(imgEl),
      referrerPolicy: getReferrerPolicy(imgEl),
    };
  }

  // 7. message listener

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request?.type !== "DOWNLOAD_EXTRACT_IMAGE_METADATA") return;

    const imgUrl = request.imageUrl || "";
    const imgEl = findBestMatchingImage(imgUrl);

    const pageUrl = location.href;
    const pageTitle = document.title;

    // page-level
    const canonicalUrl = getCanonicalUrl();

    if (!imgEl) {
      sendResponse(
        buildFailurePayload({
          imgUrl,
          pageUrl,
          pageTitle,
          canonicalUrl,
          error: "no_matching_img",
        })
      );
      return; // sync response
    }

    sendResponse(
      buildSuccessPayload({
        imgEl,
        imgUrl,
        pageUrl,
        pageTitle,
        canonicalUrl,
      })
    );
    // Response is sent synchronously; no need to return true.
  });

}

