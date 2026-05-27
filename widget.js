(function () {
  "use strict";

  var tasks = [
    { key: "front_left_45", label: "Exterior front-left 45 degrees" },
    { key: "front_right_45", label: "Exterior front-right 45 degrees" },
    { key: "rear_left_45", label: "Exterior rear-left 45 degrees" },
    { key: "rear_right_45", label: "Exterior rear-right 45 degrees" },
    { key: "vin_plate", label: "VIN / vehicle plate" },
    { key: "front_seats", label: "Interior front seats" },
    { key: "rear_seats", label: "Interior rear seats" },
    { key: "dashboard", label: "Dashboard" },
    { key: "odometer", label: "Odometer reading" }
  ];

  var video = document.getElementById("cameraVideo");
  var canvas = document.getElementById("photoCanvas");
  var preview = document.getElementById("photoPreview");
  var emptyState = document.getElementById("emptyState");
  var gpsText = document.getElementById("gpsText");
  var timeText = document.getElementById("timeText");
  var message = document.getElementById("message");
  var startCameraButton = document.getElementById("startCameraButton");
  var captureButton = document.getElementById("captureButton");
  var retakeButton = document.getElementById("retakeButton");
  var connectDropboxButton = document.getElementById("connectDropboxButton");
  var disconnectDropboxButton = document.getElementById("disconnectDropboxButton");
  var stepProgress = document.getElementById("stepProgress");
  var stepTitle = document.getElementById("stepTitle");
  var taskHint = document.getElementById("taskHint");
  var thumbs = document.getElementById("thumbs");
  var dropboxText = document.getElementById("dropboxText");
  var uploadProgress = document.getElementById("uploadProgress");
  var uploadProgressText = document.getElementById("uploadProgressText");
  var uploadProgressPercent = document.getElementById("uploadProgressPercent");
  var uploadProgressBar = document.getElementById("uploadProgressBar");

  var stream = null;
  var locationSnapshot = null;
  var widgetReady = false;
  var currentIndex = 0;
  var params = new URLSearchParams(window.location.search);
  var formId = params.get("formId") || "";
  var formFolder = params.get("folder") || "";
  var installKey = params.get("installKey") || "";
  var ownerMode = params.get("owner") === "1" || params.get("admin") === "1";
  var customer = params.get("customer") || params.get("name") || "";
  var email = params.get("email") || "";
  var nameField = params.get("nameField") || params.get("nameFieldName") || "";
  var emailField = params.get("emailField") || params.get("emailFieldName") || "";
  var nameFieldId = params.get("nameFieldId") || "";
  var emailFieldId = params.get("emailFieldId") || "";
  var nameSelector = params.get("nameSelector") || "";
  var emailSelector = params.get("emailSelector") || "";
  var jotformSubmitter = {
    name: customer,
    email: email
  };
  var submissionId = params.get("submission") || params.get("submissionId") || "";
  var dropboxConnected = false;
  var captureToken = "jf-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  var submissionStamp = folderTimestamp(new Date());
  var isUploading = false;
  var photos = tasks.map(function (task) {
    return {
      key: task.key,
      label: task.label,
      imageDataUrl: "",
      metadata: null,
      upload: null,
      error: ""
    };
  });

  var imageMaxWidth = 1280;
  var jpegQuality = 0.86;

  function resizeWidget() {
    if (window.JFCustomWidget && typeof window.JFCustomWidget.requestFrameResize === "function") {
      window.JFCustomWidget.requestFrameResize({
        height: document.documentElement.scrollHeight
      });
    }
  }

  function setMessage(text) {
    message.textContent = text || "";
    resizeWidget();
  }

  function getTimeSnapshot() {
    var date = new Date();

    return {
      iso: date.toISOString(),
      local: date.toLocaleString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
      }),
      timezoneOffsetMinutes: date.getTimezoneOffset()
    };
  }

  function refreshClock() {
    timeText.textContent = "Time: " + getTimeSnapshot().local;
  }

  function currentSubmitter() {
    return {
      name: String(jotformSubmitter.name || "").trim(),
      email: String(jotformSubmitter.email || "").trim(),
      submissionId: submissionId
    };
  }

  function folderTimestamp(date) {
    function pad(value) {
      return String(value).padStart(2, "0");
    }

    return [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate())
    ].join("") + "-" + [
      pad(date.getHours()),
      pad(date.getMinutes()),
      pad(date.getSeconds())
    ].join("");
  }

  function stringifyFieldValue(value) {
    if (value == null) return "";
    if (typeof value === "string") return value.trim();
    if (typeof value === "number") return String(value);
    if (typeof value === "object") {
      if (value.full) return String(value.full).trim();
      if (value.fullName) return String(value.fullName).trim();
      if (value.email) return String(value.email).trim();
      if (value.answer) return stringifyFieldValue(value.answer);

      var parts = [
        value.first,
        value.middle,
        value.last
      ].filter(Boolean);
      if (parts.length) return parts.join(" ").trim();

      return Object.keys(value).map(function (key) {
        return value[key];
      }).filter(Boolean).join(" ").trim();
    }
    return "";
  }

  function valueFromJotformPayload(payload, key) {
    if (!payload || !key) return "";
    if (payload[key] != null) return stringifyFieldValue(payload[key]);
    if (payload.data && payload.data[key] != null) return stringifyFieldValue(payload.data[key]);
    if (Array.isArray(payload)) {
      for (var i = 0; i < payload.length; i++) {
        var item = payload[i];
        if (item && (String(item.name) === String(key) || String(item.id) === String(key) || String(item.qid) === String(key))) {
          return stringifyFieldValue(item.value || item.answer || item.text);
        }
      }
    }
    return "";
  }

  function applySubmitterFromPayload(payload) {
    var name = valueFromJotformPayload(payload, nameField || nameFieldId);
    var mail = valueFromJotformPayload(payload, emailField || emailFieldId);
    if (name) jotformSubmitter.name = name;
    if (mail) jotformSubmitter.email = mail;
    render();
  }

  function readParentValue(selector) {
    if (!selector) return "";
    try {
      var doc = window.parent && window.parent.document;
      if (!doc) return "";
      var el = doc.querySelector(selector);
      if (!el) return "";
      return stringifyFieldValue(el.value || el.textContent || "");
    } catch (_) {
      return "";
    }
  }

  function readParentNameById(id) {
    if (!id) return "";
    var first = readParentValue("#first_" + id);
    var last = readParentValue("#last_" + id);
    var full = [first, last].filter(Boolean).join(" ").trim();
    return full || readParentValue("#input_" + id);
  }

  function readParentEmailById(id) {
    if (!id) return "";
    return readParentValue("#input_" + id);
  }

  function readParentSubmitter() {
    var name = readParentValue(nameSelector) || readParentNameById(nameFieldId);
    var mail = readParentValue(emailSelector) || readParentEmailById(emailFieldId);
    if (name) jotformSubmitter.name = name;
    if (mail) jotformSubmitter.email = mail;
  }

  function readJotformSubmitter() {
    readParentSubmitter();
    if (!window.JFCustomWidget) {
      render();
      return;
    }

    if ((nameField || emailField) && typeof JFCustomWidget.getFieldsValueByName === "function") {
      JFCustomWidget.getFieldsValueByName([nameField, emailField].filter(Boolean), applySubmitterFromPayload);
    }

    if ((nameFieldId || emailFieldId) && typeof JFCustomWidget.getFieldsValueById === "function") {
      JFCustomWidget.getFieldsValueById([nameFieldId, emailFieldId].filter(Boolean), applySubmitterFromPayload);
    }
    render();
  }

  function listenToJotformSubmitterFields() {
    if (!window.JFCustomWidget || typeof JFCustomWidget.listenFromField !== "function") return;

    [nameField, emailField, nameFieldId, emailFieldId].filter(Boolean).forEach(function (field) {
      JFCustomWidget.listenFromField(field, "change", readJotformSubmitter);
      JFCustomWidget.listenFromField(field, "keyup", readJotformSubmitter);
    });
  }

  function uploadedCount() {
    return photos.filter(function (item) {
      return Boolean(item.upload && (item.upload.url || item.upload.key) && item.upload.sha256);
    }).length;
  }

  function capturedCount() {
    return photos.filter(function (item) {
      return Boolean(item.imageDataUrl);
    }).length;
  }

  function allCaptured() {
    return capturedCount() === photos.length;
  }

  function isComplete() {
    return uploadedCount() === photos.length;
  }

  function buildValueData() {
    if (!isComplete()) return "";

    return {
      proofMode: "camera-only-9-photos-linked",
      captureToken: captureToken,
      installKey: resolveInstallKey(),
      formId: formId,
      total: photos.length,
      completedAt: new Date().toISOString(),
      dropboxFolderUrl: photos[0] && photos[0].upload && photos[0].upload.folderUrl,
      dropboxFolderPath: photos[0] && photos[0].upload && photos[0].upload.folderKey,
      submitter: {
        name: currentSubmitter().name,
        email: currentSubmitter().email,
        submissionId: submissionId
      },
      photos: photos.map(function (item, index) {
        return {
          index: index + 1,
          key: item.key,
          label: item.label,
          url: item.upload.url,
          storageKey: item.upload.key,
          metadataKey: item.upload.metadataKey,
          folderUrl: item.upload.folderUrl,
          folderKey: item.upload.folderKey,
          sha256: item.upload.sha256,
          bytes: item.upload.bytes,
          contentType: item.upload.contentType,
          uploadedAt: item.upload.uploadedAt,
          metadata: item.metadata
        };
      })
    };
  }

  function buildValue() {
    var data = buildValueData();
    if (!data) return "";

    var lines = [
      "Dropbox folder: " + (data.dropboxFolderUrl || ""),
      "Submitter: " + [data.submitter.name, data.submitter.email].filter(Boolean).join(" / "),
      "Capture token: " + data.captureToken
    ];

    data.photos.forEach(function (item) {
      lines.push("Photo " + item.index + " - " + item.label + ": " + item.url);
    });

    lines.push("Proof camera data: " + JSON.stringify(data));
    return lines.join("\n");
  }

  function resolveInstallKey() {
    if (installKey) return installKey;
    if (formId) return "form-" + formId;
    if (formFolder) return "folder-" + formFolder;
    return "";
  }

  function sendCurrentValue() {
    if (!window.JFCustomWidget || !widgetReady) return;

    window.JFCustomWidget.sendData({
      value: buildValue()
    });
  }

  function renderThumbs() {
    thumbs.innerHTML = "";

    photos.forEach(function (photo, index) {
      var tile = document.createElement("button");
      tile.type = "button";
      tile.className =
        "thumb" +
        (photo.imageDataUrl ? " captured" : "") +
        (photo.upload ? " uploaded" : "") +
        (photo.error ? " failed" : "") +
        (index === currentIndex ? " active" : "");
      tile.setAttribute("aria-label", photo.label);

      var img = document.createElement("img");
      img.alt = photo.label;
      img.src = photo.imageDataUrl || "";

      var label = document.createElement("span");
      var state = photo.upload ? " uploaded" : photo.error ? " failed" : photo.imageDataUrl ? " captured" : "";
      label.textContent = index + 1 + ". " + photo.label + state;

      tile.appendChild(img);
      tile.appendChild(label);
      tile.addEventListener("click", function () {
        currentIndex = index;
        if (photo.imageDataUrl) {
          preview.src = photo.imageDataUrl;
          preview.hidden = false;
          video.hidden = true;
        } else if (stream) {
          preview.hidden = true;
          video.hidden = false;
        }
        render();
      });

      thumbs.appendChild(tile);
    });

    resizeWidget();
  }

  function render() {
    var currentTask = tasks[currentIndex] || tasks[0];
    var captured = capturedCount();
    var uploaded = uploadedCount();

    stepProgress.textContent = Math.min(currentIndex + 1, tasks.length) + "/" + tasks.length;
    stepTitle.textContent = currentTask.label;
    taskHint.textContent = "Capture: " + currentTask.label;

    if (isUploading) {
      captureButton.textContent = "Uploading...";
      captureButton.disabled = true;
      retakeButton.disabled = true;
    } else if (isComplete()) {
      captureButton.textContent = "All uploaded";
      captureButton.disabled = true;
      retakeButton.disabled = false;
      setMessage("All 9 photos are uploaded. Submit the Jotform form to attach these links to this submission.");
    } else if (allCaptured()) {
      captureButton.textContent = "Upload all photos";
      captureButton.disabled = !dropboxConnected;
      retakeButton.disabled = !photos[currentIndex].imageDataUrl;
      if (!photos[currentIndex].imageDataUrl) {
        setMessage("Retake the selected photo, then upload all photos.");
      } else if (photos[currentIndex].error) {
        setMessage("Upload failed for " + photos[currentIndex].label + ". Tap Upload all photos to retry, or Retake this item.");
      } else {
        setMessage(dropboxConnected
          ? "All 9 photos are captured. Tap Upload all photos to send them to Dropbox."
          : ownerMode
            ? "All 9 photos are captured. Connect Dropbox before uploading."
            : "This form is not ready for uploads. Please contact the form owner.");
      }
    } else {
      captureButton.textContent =
        currentIndex < tasks.length - 1 ? "Capture and next" : "Capture final photo";
      captureButton.disabled = !stream;
      retakeButton.disabled = !photos[currentIndex].imageDataUrl;
      if (captured > 0) setMessage("Captured " + captured + "/" + tasks.length + " photos. Uploaded " + uploaded + "/" + tasks.length + ".");
    }

    renderThumbs();
  }

  function requestLocation() {
    if (!navigator.geolocation) {
      gpsText.textContent = "Location: unsupported";
      return Promise.resolve(null);
    }

    gpsText.textContent = "Location: requesting";

    return new Promise(function (resolve) {
      navigator.geolocation.getCurrentPosition(
        function (position) {
          locationSnapshot = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            altitude: position.coords.altitude,
            altitudeAccuracy: position.coords.altitudeAccuracy,
            heading: position.coords.heading,
            speed: position.coords.speed,
            sourceTimestamp: new Date(position.timestamp).toISOString()
          };

          gpsText.textContent =
            "GPS: " +
            locationSnapshot.latitude.toFixed(6) +
            ", " +
            locationSnapshot.longitude.toFixed(6) +
            " +/-" +
            Math.round(locationSnapshot.accuracy) +
            "m";

          resolve(locationSnapshot);
          resizeWidget();
        },
        function (error) {
          locationSnapshot = null;
          gpsText.textContent = "Location: denied";
          setMessage("Location permission is required for proof photos. " + error.message);
          resolve(null);
        },
        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0
        }
      );
    });
  }

  function stopCamera() {
    if (!stream) return;

    stream.getTracks().forEach(function (track) {
      track.stop();
    });
    stream = null;
  }

  async function startCamera() {
    setMessage("");
    refreshClock();
    await requestLocation();

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setMessage("Camera access is not available in this browser.");
      return;
    }

    try {
      var constraints = {
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 960 }
        }
      };
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (_) {
        constraints.video.facingMode = "environment";
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      }

      video.srcObject = stream;
      video.hidden = false;
      preview.hidden = true;
      emptyState.hidden = true;
      startCameraButton.disabled = true;
      captureButton.disabled = false;
      retakeButton.disabled = Boolean(photos[currentIndex].imageDataUrl) ? false : true;
      render();
    } catch (error) {
      setMessage("Camera permission is required. " + error.message);
    }
  }

  function drawWatermark(context, width, height, meta) {
    var gpsLine = meta.location
      ? "GPS: " +
        meta.location.latitude.toFixed(6) +
        ", " +
        meta.location.longitude.toFixed(6) +
        " +/-" +
        Math.round(meta.location.accuracy) +
        "m"
      : "GPS: unavailable";

    var lines = [
      meta.index + "/9 " + meta.label,
      "Time: " + meta.time.local,
      gpsLine
    ];
    var padding = Math.max(14, Math.round(width * 0.018));
    var fontSize = Math.max(18, Math.round(width * 0.026));
    var lineHeight = Math.round(fontSize * 1.38);
    var boxHeight = padding * 2 + lineHeight * lines.length;

    context.save();
    context.fillStyle = "rgba(0, 0, 0, 0.66)";
    context.fillRect(0, height - boxHeight, width, boxHeight);
    context.fillStyle = "#ffffff";
    context.font = "700 " + fontSize + "px Arial, sans-serif";
    context.textBaseline = "top";

    lines.forEach(function (line, index) {
      context.fillText(line, padding, height - boxHeight + padding + index * lineHeight);
    });

    context.restore();
  }

  function showCurrentLiveCamera() {
    if (!stream) return;

    preview.hidden = true;
    video.hidden = false;
  }

  async function uploadPhoto(imageDataUrl, metadata) {
    var submitter = currentSubmitter();
    var response = await fetch("/api/upload", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        captureToken: captureToken,
        formId: formId,
        folder: submissionFolder(),
        installKey: resolveInstallKey(),
        index: metadata.index,
        photoKey: metadata.key,
        submitterName: submitter.name,
        submitterEmail: submitter.email,
        imageDataUrl: imageDataUrl,
        metadata: metadata
      })
    });

    var payload = await response.json().catch(function () {
      return {};
    });

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Upload failed");
    }

    return payload;
  }

  function capturePhoto() {
    if (!stream || !video.videoWidth || !video.videoHeight) {
      setMessage("Camera is not ready yet.");
      return;
    }

    var task = tasks[currentIndex];
    var scale = Math.min(1, imageMaxWidth / video.videoWidth);
    var width = Math.round(video.videoWidth * scale);
    var height = Math.round(video.videoHeight * scale);
    var meta = {
      index: currentIndex + 1,
      key: task.key,
      label: task.label,
      time: getTimeSnapshot(),
      location: locationSnapshot,
      submitter: {
        name: currentSubmitter().name,
        email: currentSubmitter().email,
        submissionId: submissionId
      },
      browserUserAgent: navigator.userAgent,
      proofMode: "camera-only-9-photos-linked",
      fileUploadDisabled: true
    };

    canvas.width = width;
    canvas.height = height;

    var context = canvas.getContext("2d");
    context.drawImage(video, 0, 0, width, height);
    drawWatermark(context, width, height, meta);

    var imageDataUrl = canvas.toDataURL("image/jpeg", jpegQuality);
    photos[currentIndex].imageDataUrl = imageDataUrl;
    photos[currentIndex].metadata = meta;
    photos[currentIndex].upload = null;
    photos[currentIndex].error = "";
    preview.src = imageDataUrl;
    preview.hidden = false;
    video.hidden = true;

    if (!allCaptured()) {
      var nextMissing = photos.findIndex(function (item) {
        return !item.imageDataUrl;
      });
      currentIndex = nextMissing >= 0 ? nextMissing : currentIndex;
      showCurrentLiveCamera();
    }

    render();
  }

  function safePathPart(value) {
    return String(value || "")
      .trim()
      .replace(/[^a-zA-Z0-9._@-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
  }

  function submissionFolder() {
    var base = formFolder || (formId ? "form-" + formId : "default");
    var submitter = currentSubmitter();
    var who = safePathPart(submitter.name || submitter.email || submissionId || "unknown");
    return base + "/" + [who, submissionStamp].filter(Boolean).join("-");
  }

  function setUploadProgress(done, total, label) {
    var percent = total ? Math.round((done / total) * 100) : 0;
    uploadProgress.hidden = false;
    uploadProgressText.textContent = label || "Uploading " + done + "/" + total;
    uploadProgressPercent.textContent = percent + "%";
    uploadProgressBar.style.width = percent + "%";
    resizeWidget();
  }

  async function uploadAllPhotos() {
    if (!allCaptured()) {
      setMessage("Please capture all 9 photos before uploading.");
      return;
    }
    if (!dropboxConnected) {
      setMessage(ownerMode
        ? "Dropbox is not connected. Connect Dropbox before uploading."
        : "This form is not ready for uploads. Please contact the form owner.");
      return;
    }

    isUploading = true;
    setUploadProgress(uploadedCount(), photos.length, "Preparing uploads");
    render();

    try {
      for (var i = 0; i < photos.length; i++) {
        if (photos[i].upload) continue;

        currentIndex = i;
        setUploadProgress(uploadedCount(), photos.length, "Uploading " + (uploadedCount() + 1) + "/" + photos.length + ": " + photos[i].label);
        setMessage("Uploading " + (i + 1) + "/9: " + photos[i].label + "...");
        renderThumbs();
        photos[i].upload = await uploadPhoto(photos[i].imageDataUrl, photos[i].metadata);
        photos[i].error = "";
        setUploadProgress(uploadedCount(), photos.length, "Uploaded " + uploadedCount() + "/" + photos.length);
      }

      sendCurrentValue();
      setUploadProgress(photos.length, photos.length, "Upload complete");
      setMessage("All 9 photos are uploaded. Submit the Jotform form to attach these links to this submission.");
    } catch (error) {
      photos[currentIndex].upload = null;
      photos[currentIndex].error = error.message || "Upload failed";
      setUploadProgress(uploadedCount(), photos.length, "Upload failed at " + photos[currentIndex].label);
      setMessage("Upload failed for " + photos[currentIndex].label + ". Tap Upload all photos to retry, or Retake this item.");
    } finally {
      isUploading = false;
      render();
    }
  }

  function retakeCurrent() {
    photos[currentIndex].imageDataUrl = "";
    photos[currentIndex].metadata = null;
    photos[currentIndex].upload = null;
    photos[currentIndex].error = "";
    showCurrentLiveCamera();
    sendCurrentValue();
    render();
  }

  function submitWidget() {
    if (!window.JFCustomWidget) return;

    if (!isComplete()) {
      window.JFCustomWidget.sendSubmit({
        valid: false,
        value: "",
        message: "Please complete and upload all 9 required photos."
      });
      return;
    }

    window.JFCustomWidget.sendSubmit({
      valid: true,
      value: buildValue()
    });
  }

  async function checkDropboxStatus() {
    var key = resolveInstallKey();
    if (!key) {
      dropboxConnected = false;
      dropboxText.textContent = "Dropbox: waiting for form";
      connectDropboxButton.hidden = !ownerMode;
      disconnectDropboxButton.hidden = true;
      return;
    }

    try {
      var response = await fetch("/api/dropbox/status?installKey=" + encodeURIComponent(key));
      var status = await response.json().catch(function () {
        return {};
      });
      dropboxConnected = Boolean(response.ok && status.connected);
      dropboxText.textContent = dropboxConnected
        ? "Dropbox: connected" + (status.accountEmail ? " (" + status.accountEmail + ")" : "")
        : "Dropbox: not connected";
      connectDropboxButton.hidden = !ownerMode;
      connectDropboxButton.textContent = dropboxConnected ? "Reconnect Dropbox" : "Connect Dropbox";
      disconnectDropboxButton.hidden = !ownerMode || !dropboxConnected;
    } catch (error) {
      dropboxConnected = false;
      dropboxText.textContent = "Dropbox: status failed";
      connectDropboxButton.hidden = !ownerMode;
      connectDropboxButton.textContent = "Connect Dropbox";
      disconnectDropboxButton.hidden = true;
    }

    render();
  }

  function connectDropbox() {
    var key = resolveInstallKey();
    if (!key) {
      setMessage("Open this widget inside a Jotform form first, or add ?installKey=your-id to the widget URL.");
      return;
    }

    var returnTo = "/connected.html?installKey=" + encodeURIComponent(key);
    var popup = window.open(
      "/api/dropbox/connect?installKey=" +
      encodeURIComponent(key) +
      "&returnTo=" +
      encodeURIComponent(returnTo),
      "connect-dropbox",
      "width=720,height=760"
    );

    if (!popup) {
      setMessage("Popup blocked. Please allow popups and try Connect Dropbox again.");
      return;
    }

    var timer = setInterval(function () {
      if (popup.closed) {
        clearInterval(timer);
        checkDropboxStatus();
      }
    }, 1200);
  }

  async function disconnectDropbox() {
    var key = resolveInstallKey();
    if (!key) return;

    disconnectDropboxButton.disabled = true;
    try {
      await fetch("/api/dropbox/disconnect", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ installKey: key })
      });
      dropboxConnected = false;
      dropboxText.textContent = "Dropbox: not connected";
      connectDropboxButton.hidden = !ownerMode;
      connectDropboxButton.textContent = "Connect Dropbox";
      disconnectDropboxButton.hidden = true;
      setMessage("Dropbox has been disconnected for this form.");
      render();
    } finally {
      disconnectDropboxButton.disabled = false;
    }
  }

  startCameraButton.addEventListener("click", startCamera);
  captureButton.addEventListener("click", function () {
    if (allCaptured() && !isComplete()) {
      uploadAllPhotos();
    } else {
      capturePhoto();
    }
  });
  retakeButton.addEventListener("click", retakeCurrent);
  connectDropboxButton.addEventListener("click", connectDropbox);
  disconnectDropboxButton.addEventListener("click", disconnectDropbox);
  window.addEventListener("pagehide", stopCamera);
  window.addEventListener("resize", resizeWidget);

  refreshClock();
  setInterval(refreshClock, 1000);
  setInterval(readJotformSubmitter, 1000);

  if (window.JFCustomWidget) {
    window.JFCustomWidget.subscribe("ready", function (data) {
      widgetReady = true;
      formId = formId || (data && (data.formID || data.formId || data.form_id)) || "";
      formFolder = formFolder || (formId ? "form-" + formId : "default");
      installKey = installKey || (formId ? "form-" + formId : "");
      readJotformSubmitter();
      listenToJotformSubmitterFields();
      checkDropboxStatus();
      sendCurrentValue();
      resizeWidget();
    });

    window.JFCustomWidget.subscribe("submit", submitWidget);
  }

  render();
  checkDropboxStatus();
  resizeWidget();
})();
