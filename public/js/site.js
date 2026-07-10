(function () {
  const toggle = document.querySelector(".nav-toggle");
  const links = document.querySelector(".nav-links");
  if (toggle && links) {
    const setOpen = (open) => {
      links.classList.toggle("open", !!open);
      document.body.classList.toggle("menu-open", !!open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    };
    // Use pointerup so iOS/Safari reliably fires even over sticky/backdrop layers
    toggle.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      setOpen(!links.classList.contains("open"));
    });
    links.querySelectorAll("a").forEach((a) =>
      a.addEventListener("click", () => setOpen(false))
    );
    window.addEventListener("resize", () => {
      if (window.innerWidth > 960) setOpen(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") setOpen(false);
    });
  }

  // Full-size photo lightbox (home + any [data-lightbox] trigger)
  (function initLightbox() {
    let overlay = null;
    let imgEl = null;
    let capEl = null;
    let lastFocus = null;

    const ensure = () => {
      if (overlay) return overlay;
      overlay = document.createElement("div");
      overlay.className = "lightbox";
      overlay.hidden = true;
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.setAttribute("aria-label", "Full size photograph");
      overlay.innerHTML =
        '<button type="button" class="lightbox-close" aria-label="Close photo">&times;</button>' +
        '<figure class="lightbox-figure">' +
        '<img class="lightbox-img" alt="" />' +
        '<figcaption class="lightbox-caption"></figcaption>' +
        "</figure>";
      document.body.appendChild(overlay);
      imgEl = overlay.querySelector(".lightbox-img");
      capEl = overlay.querySelector(".lightbox-caption");
      const closeBtn = overlay.querySelector(".lightbox-close");

      const close = () => {
        overlay.hidden = true;
        overlay.classList.remove("is-open");
        document.body.classList.remove("lightbox-open");
        if (imgEl) {
          imgEl.removeAttribute("src");
          imgEl.alt = "";
        }
        if (capEl) capEl.textContent = "";
        if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
        lastFocus = null;
      };

      closeBtn.addEventListener("click", close);
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) close();
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && overlay && !overlay.hidden) {
          e.preventDefault();
          close();
        }
      });
      overlay._close = close;
      return overlay;
    };

    const open = (src, caption, alt) => {
      if (!src) return;
      const box = ensure();
      lastFocus = document.activeElement;
      imgEl.src = src;
      imgEl.alt = alt || caption || "Family photograph";
      capEl.textContent = caption || "";
      capEl.hidden = !caption;
      box.hidden = false;
      box.classList.add("is-open");
      document.body.classList.add("lightbox-open");
      const closeBtn = box.querySelector(".lightbox-close");
      if (closeBtn) closeBtn.focus();
    };

    document.addEventListener("click", (e) => {
      const trigger = e.target.closest("[data-lightbox]");
      if (!trigger) return;
      e.preventDefault();
      const src = trigger.getAttribute("data-lightbox");
      const caption = trigger.getAttribute("data-lightbox-caption") || "";
      const img = trigger.querySelector("img");
      const alt = (img && img.getAttribute("alt")) || caption;
      open(src, caption, alt);
    });
  })();

  // Multi person-name fields on contribute form
  const addPersonBtn = document.getElementById("add-person-field");
  const peopleFields = document.getElementById("people-fields");
  if (addPersonBtn && peopleFields) {
    addPersonBtn.addEventListener("click", () => {
      const input = document.createElement("input");
      input.type = "text";
      input.name = "person_name";
      input.placeholder = "Full name of a person in the photo";
      input.maxLength = 120;
      peopleFields.appendChild(input);
    });
  }

  // Bulk photo/video upload zones — drag & drop + multi-select + accumulate batches
  (function initBulkUploads() {
    const zones = document.querySelectorAll("[data-bulk-upload]");
    if (!zones.length) return;

    const isImage = (f) =>
      (f && f.type && f.type.startsWith("image/")) ||
      /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(f && f.name ? f.name : "");
    const isVideo = (f) =>
      (f && f.type && f.type.startsWith("video/")) ||
      /\.(mp4|webm|mov|m4v)$/i.test(f && f.name ? f.name : "");

    zones.forEach((zone) => {
      const input = zone.querySelector("[data-bulk-input]") || zone.querySelector('input[type="file"]');
      if (!input) return;
      const countEl = zone.querySelector("[data-bulk-count]");
      const previews = zone.querySelector("[data-bulk-previews]");
      const clearBtn = zone.querySelector("[data-bulk-clear]");
      const addBtn = zone.querySelector("[data-bulk-add]");
      const trigger = zone.querySelector("[data-bulk-trigger]") || zone;
      const max = Math.max(1, parseInt(zone.getAttribute("data-bulk-max") || "50", 10) || 50);
      const accept = (zone.getAttribute("data-bulk-accept") || "image").toLowerCase();
      const required = zone.getAttribute("data-bulk-required") === "1";
      let files = [];
      let objectUrls = [];

      const filterIncoming = (list) =>
        Array.from(list || []).filter((f) => {
          if (accept === "video") return isVideo(f);
          if (accept === "image") return isImage(f);
          return isImage(f) || isVideo(f);
        });

      const keyOf = (f) => `${f.name}::${f.size}::${f.lastModified}`;

      const revokeUrls = () => {
        objectUrls.forEach((u) => {
          try {
            URL.revokeObjectURL(u);
          } catch (_) { /* ignore */ }
        });
        objectUrls = [];
      };

      const syncInput = () => {
        const dt = new DataTransfer();
        files.forEach((f) => dt.items.add(f));
        input.files = dt.files;
        if (required) {
          if (files.length) input.removeAttribute("required");
          else input.setAttribute("required", "required");
        }
        if (clearBtn) clearBtn.hidden = files.length === 0;
        if (countEl) {
          if (!files.length) {
            countEl.textContent =
              accept === "video" ? "No videos selected." : "No photos selected yet.";
          } else {
            const totalMb = (files.reduce((s, f) => s + (f.size || 0), 0) / (1024 * 1024)).toFixed(1);
            const label = accept === "video" ? "video" : "photo";
            countEl.textContent =
              `${files.length} ${label}${files.length === 1 ? "" : "s"} ready` +
              (files.length >= max ? ` (max ${max})` : ` · room for ${max - files.length} more`) +
              ` · ~${totalMb} MB`;
          }
        }
        if (previews) {
          revokeUrls();
          previews.innerHTML = "";
          files.forEach((f, idx) => {
            const card = document.createElement("div");
            card.className = "bulk-preview-card";
            if (isImage(f)) {
              const url = URL.createObjectURL(f);
              objectUrls.push(url);
              const img = document.createElement("img");
              img.src = url;
              img.alt = f.name;
              card.appendChild(img);
            } else {
              const vid = document.createElement("div");
              vid.className = "bulk-preview-video";
              vid.textContent = "▶ " + (f.name || "Video");
              card.appendChild(vid);
            }
            const meta = document.createElement("div");
            meta.className = "bulk-preview-meta";
            meta.title = f.name;
            meta.textContent = f.name.length > 28 ? f.name.slice(0, 25) + "…" : f.name;
            card.appendChild(meta);
            const rm = document.createElement("button");
            rm.type = "button";
            rm.className = "bulk-preview-remove";
            rm.setAttribute("aria-label", "Remove " + f.name);
            rm.textContent = "×";
            rm.addEventListener("click", (e) => {
              e.preventDefault();
              e.stopPropagation();
              files = files.filter((_, i) => i !== idx);
              syncInput();
            });
            card.appendChild(rm);
            previews.appendChild(card);
          });
        }
      };

      const addFiles = (list) => {
        const incoming = filterIncoming(list);
        if (!incoming.length) return;
        const seen = new Set(files.map(keyOf));
        incoming.forEach((f) => {
          const k = keyOf(f);
          if (seen.has(k)) return;
          if (files.length >= max) return;
          seen.add(k);
          files.push(f);
        });
        if (files.length > max) files = files.slice(0, max);
        syncInput();
      };

      const openPicker = () => input.click();
      if (trigger) {
        trigger.addEventListener("click", (e) => {
          if (e.target.closest("button") || e.target.closest("input")) return;
          openPicker();
        });
      }
      if (addBtn) addBtn.addEventListener("click", (e) => {
        e.preventDefault();
        openPicker();
      });
      if (clearBtn) {
        clearBtn.addEventListener("click", (e) => {
          e.preventDefault();
          files = [];
          syncInput();
        });
      }

      // Native file picker adds (does not wipe previous selection)
      input.addEventListener("change", () => {
        if (input.files && input.files.length) {
          addFiles(input.files);
          // reset so same file can be re-added after remove
          try {
            input.value = "";
          } catch (_) { /* ignore */ }
          // re-sync DataTransfer files onto input
          syncInput();
        }
      });

      ["dragenter", "dragover"].forEach((ev) => {
        zone.addEventListener(ev, (e) => {
          e.preventDefault();
          e.stopPropagation();
          zone.classList.add("is-dragover");
        });
      });
      ["dragleave", "dragend"].forEach((ev) => {
        zone.addEventListener(ev, (e) => {
          e.preventDefault();
          zone.classList.remove("is-dragover");
        });
      });
      zone.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.remove("is-dragover");
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
          addFiles(e.dataTransfer.files);
        }
      });

      // Prevent browser opening file when dropped outside zone accidentally on form
      const form = zone.closest("form");
      if (form && !form._bulkDropGuard) {
        form._bulkDropGuard = true;
        form.addEventListener("dragover", (e) => e.preventDefault());
        form.addEventListener("drop", (e) => {
          if (!e.target.closest("[data-bulk-upload]")) e.preventDefault();
        });
      }

      syncInput();
    });
  })();

  const yearUnknown = document.getElementById("year_unknown");
  const yearSelect = document.getElementById("reunion_year");
  if (yearUnknown && yearSelect) {
    yearUnknown.addEventListener("change", () => {
      yearSelect.disabled = yearUnknown.checked;
      if (yearUnknown.checked) yearSelect.value = "";
    });
  }

  // Family voice recorder (browser microphone → WebM/audio file field)
  const startBtn = document.getElementById("btn-start-rec");
  const stopBtn = document.getElementById("btn-stop-rec");
  const clearBtn = document.getElementById("btn-clear-rec");
  const statusEl = document.getElementById("recorder-status");
  const timerEl = document.getElementById("recorder-timer");
  const preview = document.getElementById("recorder-preview");
  const fileInputRec = document.getElementById("recording");
  const formRec = document.getElementById("recording-form");
  const fileHint = document.getElementById("recording-file-hint");

  if (startBtn && stopBtn && fileInputRec && formRec) {
    let mediaRecorder = null;
    let chunks = [];
    let stream = null;
    let timerId = null;
    let startedAt = 0;
    let recordedBlob = null;

    const fmt = (sec) => {
      const m = Math.floor(sec / 60);
      const s = Math.floor(sec % 60);
      return m + ":" + String(s).padStart(2, "0");
    };

    const setStatus = (text, recording) => {
      if (statusEl) {
        statusEl.textContent = text;
        statusEl.classList.toggle("is-recording", !!recording);
      }
    };

    const stopTimer = () => {
      if (timerId) clearInterval(timerId);
      timerId = null;
    };

    const startTimer = () => {
      startedAt = Date.now();
      stopTimer();
      timerId = setInterval(() => {
        if (timerEl) timerEl.textContent = fmt((Date.now() - startedAt) / 1000);
      }, 250);
    };

    const pickMime = () => {
      const types = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ];
      if (!window.MediaRecorder) return "";
      for (const t of types) {
        if (MediaRecorder.isTypeSupported(t)) return t;
      }
      return "";
    };

    const attachBlobToInput = (blob) => {
      recordedBlob = blob;
      const ext = (blob.type || "").includes("mp4") ? "m4a" : (blob.type || "").includes("ogg") ? "ogg" : "webm";
      const file = new File([blob], "family-recording." + ext, { type: blob.type || "audio/webm" });
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInputRec.files = dt.files;
      fileInputRec.removeAttribute("required");
      if (fileHint) fileHint.textContent = "Recorded audio ready to submit (" + ext.toUpperCase() + ").";
      if (preview) {
        preview.src = URL.createObjectURL(blob);
        preview.style.display = "block";
      }
      clearBtn.disabled = false;
    };

    startBtn.addEventListener("click", async () => {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          setStatus("This browser cannot record audio. Please upload a file instead.");
          return;
        }
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        chunks = [];
        const mime = pickMime();
        mediaRecorder = mime
          ? new MediaRecorder(stream, { mimeType: mime })
          : new MediaRecorder(stream);
        mediaRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunks.push(e.data);
        };
        mediaRecorder.onstop = () => {
          const type = (mediaRecorder && mediaRecorder.mimeType) || "audio/webm";
          const blob = new Blob(chunks, { type });
          attachBlobToInput(blob);
          if (stream) stream.getTracks().forEach((t) => t.stop());
          stream = null;
          setStatus("Recording captured — review below, then submit.");
          startBtn.disabled = false;
          stopBtn.disabled = true;
        };
        mediaRecorder.start(250);
        startTimer();
        setStatus("Recording… speak clearly into your microphone", true);
        startBtn.disabled = true;
        stopBtn.disabled = false;
        clearBtn.disabled = true;
      } catch (err) {
        console.error(err);
        setStatus("Microphone access was blocked. Allow the mic, or upload an audio file.");
      }
    });

    stopBtn.addEventListener("click", () => {
      stopTimer();
      if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
    });

    clearBtn.addEventListener("click", () => {
      recordedBlob = null;
      chunks = [];
      fileInputRec.value = "";
      fileInputRec.setAttribute("required", "required");
      if (preview) {
        preview.removeAttribute("src");
        preview.style.display = "none";
      }
      if (timerEl) timerEl.textContent = "0:00";
      if (fileHint) fileHint.textContent = "MP3, M4A, WAV, OGG, or WebM · up to 50MB. Record above or choose a file.";
      setStatus("Ready to record");
      clearBtn.disabled = true;
    });

    fileInputRec.addEventListener("change", () => {
      if (fileInputRec.files && fileInputRec.files.length) {
        recordedBlob = null;
        if (fileHint) fileHint.textContent = "Selected: " + fileInputRec.files[0].name;
        if (preview) {
          preview.src = URL.createObjectURL(fileInputRec.files[0]);
          preview.style.display = "block";
        }
        clearBtn.disabled = false;
      }
    });
  }

  // Site analytics — page views + time on site (not on admin)
  (function initAnalytics() {
    try {
      const path = window.location.pathname || "/";
      if (path.indexOf("/admin") === 0) return;
      if (!window.fetch && !navigator.sendBeacon) return;

      const storageKey = "cmfr_vid";
      let sessionId = null;
      try {
        sessionId = sessionStorage.getItem(storageKey);
      } catch (_) { /* private mode */ }
      if (!sessionId) {
        sessionId =
          (window.crypto && crypto.randomUUID && crypto.randomUUID()) ||
          "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
        try {
          sessionStorage.setItem(storageKey, sessionId);
        } catch (_) { /* ignore */ }
      }

      const endpoint = "/api/analytics/beacon";
      let activeAccum = 0;
      let lastTick = Date.now();
      let visible = !document.hidden;

      const post = (payload, useBeacon) => {
        const body = JSON.stringify(payload);
        if (useBeacon && navigator.sendBeacon) {
          try {
            const blob = new Blob([body], { type: "application/json" });
            if (navigator.sendBeacon(endpoint, blob)) return;
          } catch (_) { /* fall through */ }
        }
        if (window.fetch) {
          fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
            keepalive: true,
            credentials: "same-origin",
          }).catch(() => {});
        }
      };

      post({
        type: "pageview",
        sessionId,
        path,
        referrer: document.referrer || "",
      });

      const flushHeartbeat = (useBeacon) => {
        if (!visible) {
          lastTick = Date.now();
          return;
        }
        const now = Date.now();
        const delta = Math.floor((now - lastTick) / 1000);
        lastTick = now;
        if (delta < 1) return;
        activeAccum += delta;
        const send = Math.min(activeAccum, 120);
        if (send < 1) return;
        activeAccum -= send;
        post(
          {
            type: "heartbeat",
            sessionId,
            path,
            seconds: send,
          },
          !!useBeacon
        );
      };

      setInterval(() => flushHeartbeat(false), 15000);
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
          flushHeartbeat(true);
          visible = false;
        } else {
          visible = true;
          lastTick = Date.now();
        }
      });
      window.addEventListener("pagehide", () => flushHeartbeat(true));
    } catch (_) {
      /* never break the site for analytics */
    }
  })();

  // Footer: reveal family contact email only after deliberate click
  (function initEmailReveal() {
    document.querySelectorAll("[data-email-reveal]").forEach((panel) => {
      const btn = panel.querySelector("[data-email-reveal-btn]");
      const target = panel.querySelector("[data-email-reveal-target]");
      if (!btn || !target) return;
      btn.addEventListener("click", () => {
        const open = target.hidden;
        target.hidden = !open;
        btn.setAttribute("aria-expanded", open ? "true" : "false");
        btn.textContent = open ? "Hide email address" : "Show email address";
        if (open) {
          const link = target.querySelector(".footer-email-link");
          if (link) link.focus();
        }
      });
    });
  })();

  // Scroll to top — floating button + footer button on every page
  (function initScrollTop() {
    const buttons = document.querySelectorAll("[data-scroll-top]");
    if (!buttons.length) return;
    const fab = document.querySelector(".scroll-top-fab");

    const goTop = () => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    };

    buttons.forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        goTop();
      });
    });

    if (!fab) return;
    const onScroll = () => {
      const y = window.scrollY || document.documentElement.scrollTop || 0;
      if (y > 280) {
        fab.hidden = false;
        fab.classList.add("is-visible");
      } else {
        fab.classList.remove("is-visible");
        // keep focusable only when visible
        window.setTimeout(() => {
          if (!fab.classList.contains("is-visible")) fab.hidden = true;
        }, 200);
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  })();
})();
