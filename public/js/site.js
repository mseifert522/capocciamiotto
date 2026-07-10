(function () {
  const toggle = document.querySelector(".nav-toggle");
  const links = document.querySelector(".nav-links");
  if (toggle && links) {
    const setOpen = (open) => {
      links.classList.toggle("open", open);
      document.body.classList.toggle("menu-open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    };
    toggle.addEventListener("click", () => setOpen(!links.classList.contains("open")));
    links.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => setOpen(false)));
  }

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

  // Dropzone file input
  const drop = document.getElementById("dropzone");
  const fileInput = document.getElementById("photos-input");
  const fileList = document.getElementById("file-list");
  if (drop && fileInput) {
    const showFiles = () => {
      if (!fileList) return;
      const files = Array.from(fileInput.files || []);
      fileList.textContent = files.length
        ? files.map((f) => f.name).join(", ")
        : "No files selected yet.";
    };
    drop.addEventListener("click", () => fileInput.click());
    drop.addEventListener("dragover", (e) => {
      e.preventDefault();
      drop.style.borderColor = "#6b1f2a";
    });
    drop.addEventListener("dragleave", () => {
      drop.style.borderColor = "";
    });
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.style.borderColor = "";
      if (e.dataTransfer.files?.length) {
        fileInput.files = e.dataTransfer.files;
        showFiles();
      }
    });
    fileInput.addEventListener("change", showFiles);
  }

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
})();
