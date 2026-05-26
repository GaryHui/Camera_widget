(function () {
  "use strict";

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

  var stream = null;
  var locationSnapshot = null;
  var proofValue = "";
  var widgetReady = false;

  var imageMaxWidth = 1280;
  var jpegQuality = 0.88;

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
    timeText.textContent = "时间：" + getTimeSnapshot().local;
  }

  function requestLocation() {
    if (!navigator.geolocation) {
      gpsText.textContent = "定位：浏览器不支持";
      return Promise.resolve(null);
    }

    gpsText.textContent = "定位：正在获取";

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
            "定位：" +
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
          gpsText.textContent = "定位：未授权";
          setMessage("需要允许定位权限，才能生成带定位证明的照片。" + error.message);
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
      setMessage("当前浏览器不支持摄像头调用。");
      return;
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 960 }
        }
      });

      video.srcObject = stream;
      video.hidden = false;
      preview.hidden = true;
      emptyState.hidden = true;
      startCameraButton.disabled = true;
      captureButton.disabled = false;
      retakeButton.disabled = true;
      resizeWidget();
    } catch (error) {
      setMessage("需要允许摄像头权限，才能现场拍照。" + error.message);
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

    var lines = ["现场拍照证明", "时间: " + meta.time.local, gpsLine];
    var padding = Math.max(14, Math.round(width * 0.018));
    var fontSize = Math.max(18, Math.round(width * 0.026));
    var lineHeight = Math.round(fontSize * 1.38);
    var boxHeight = padding * 2 + lineHeight * lines.length;

    context.save();
    context.fillStyle = "rgba(0, 0, 0, 0.66)";
    context.fillRect(0, height - boxHeight, width, boxHeight);
    context.fillStyle = "#ffffff";
    context.font = "700 " + fontSize + "px Arial, Microsoft YaHei, sans-serif";
    context.textBaseline = "top";

    lines.forEach(function (line, index) {
      context.fillText(line, padding, height - boxHeight + padding + index * lineHeight);
    });

    context.restore();
  }

  function sendCurrentValue() {
    if (!window.JFCustomWidget || !widgetReady) return;

    window.JFCustomWidget.sendData({
      value: proofValue
    });
  }

  function capturePhoto() {
    if (!stream || !video.videoWidth || !video.videoHeight) {
      setMessage("摄像头还没有准备好，请稍等。");
      return;
    }

    var scale = Math.min(1, imageMaxWidth / video.videoWidth);
    var width = Math.round(video.videoWidth * scale);
    var height = Math.round(video.videoHeight * scale);
    var meta = {
      time: getTimeSnapshot(),
      location: locationSnapshot,
      browserUserAgent: navigator.userAgent,
      proofMode: "camera-only",
      fileUploadDisabled: true
    };

    canvas.width = width;
    canvas.height = height;

    var context = canvas.getContext("2d");
    context.drawImage(video, 0, 0, width, height);
    drawWatermark(context, width, height, meta);

    var imageDataUrl = canvas.toDataURL("image/jpeg", jpegQuality);
    proofValue = JSON.stringify({
      imageDataUrl: imageDataUrl,
      metadata: meta
    });

    preview.src = imageDataUrl;
    preview.hidden = false;
    video.hidden = true;
    captureButton.disabled = true;
    retakeButton.disabled = false;
    setMessage("");
    sendCurrentValue();
    resizeWidget();
  }

  function retakePhoto() {
    proofValue = "";
    preview.removeAttribute("src");
    preview.hidden = true;
    video.hidden = false;
    captureButton.disabled = !stream;
    retakeButton.disabled = true;
    setMessage("");
    sendCurrentValue();
    resizeWidget();
  }

  function submitWidget() {
    if (!window.JFCustomWidget) return;

    if (!proofValue) {
      window.JFCustomWidget.sendSubmit({
        valid: false,
        value: "",
        message: "请先完成现场拍照。"
      });
      return;
    }

    window.JFCustomWidget.sendSubmit({
      valid: true,
      value: proofValue
    });
  }

  startCameraButton.addEventListener("click", startCamera);
  captureButton.addEventListener("click", capturePhoto);
  retakeButton.addEventListener("click", retakePhoto);
  window.addEventListener("pagehide", stopCamera);
  window.addEventListener("resize", resizeWidget);

  refreshClock();
  setInterval(refreshClock, 1000);

  if (window.JFCustomWidget) {
    window.JFCustomWidget.subscribe("ready", function () {
      widgetReady = true;
      sendCurrentValue();
      resizeWidget();
    });

    window.JFCustomWidget.subscribe("submit", submitWidget);
  }

  resizeWidget();
})();
