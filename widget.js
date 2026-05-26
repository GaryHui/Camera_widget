(function () {
  "use strict";

  var tasks = [
    { key: "front_left_45", label: "车身左前 45 度" },
    { key: "front_right_45", label: "车身右前 45 度" },
    { key: "rear_left_45", label: "车身左后 45 度" },
    { key: "rear_right_45", label: "车身右后 45 度" },
    { key: "vin_plate", label: "VIN / 铭牌" },
    { key: "front_seats", label: "前排座椅" },
    { key: "rear_seats", label: "后排座椅" },
    { key: "dashboard", label: "仪表台" },
    { key: "odometer", label: "里程表读数" }
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
  var stepProgress = document.getElementById("stepProgress");
  var stepTitle = document.getElementById("stepTitle");
  var taskHint = document.getElementById("taskHint");
  var thumbs = document.getElementById("thumbs");

  var stream = null;
  var locationSnapshot = null;
  var widgetReady = false;
  var currentIndex = 0;
  var photos = tasks.map(function (task) {
    return {
      key: task.key,
      label: task.label,
      imageDataUrl: "",
      metadata: null
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
    timeText.textContent = "时间：" + getTimeSnapshot().local;
  }

  function completedCount() {
    return photos.filter(function (item) {
      return Boolean(item.imageDataUrl);
    }).length;
  }

  function isComplete() {
    return completedCount() === photos.length;
  }

  function buildValue() {
    if (!isComplete()) return "";

    return JSON.stringify({
      proofMode: "camera-only-9-photos",
      total: photos.length,
      completedAt: new Date().toISOString(),
      photos: photos.map(function (item, index) {
        return {
          index: index + 1,
          key: item.key,
          label: item.label,
          imageDataUrl: item.imageDataUrl,
          metadata: item.metadata
        };
      })
    });
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
        (photo.imageDataUrl ? " done" : "") +
        (index === currentIndex ? " active" : "");
      tile.setAttribute("aria-label", photo.label);

      var img = document.createElement("img");
      img.alt = photo.label;
      img.src = photo.imageDataUrl || "";

      var label = document.createElement("span");
      label.textContent = index + 1 + ". " + photo.label;

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
    var count = completedCount();

    stepProgress.textContent = Math.min(currentIndex + 1, tasks.length) + "/" + tasks.length;
    stepTitle.textContent = currentTask.label;
    taskHint.textContent = "请拍摄：" + currentTask.label;

    if (isComplete()) {
      captureButton.textContent = "全部完成";
      captureButton.disabled = true;
      retakeButton.disabled = false;
      setMessage("9 张照片已完成，可以提交 Jotform 表单。");
    } else {
      captureButton.textContent =
        currentIndex < tasks.length - 1 ? "拍摄并进入下一张" : "拍摄最后一张";
      captureButton.disabled = !stream;
      retakeButton.disabled = !photos[currentIndex].imageDataUrl;
      if (count > 0) setMessage("已完成 " + count + "/" + tasks.length + " 张。");
    }

    renderThumbs();
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
      retakeButton.disabled = Boolean(photos[currentIndex].imageDataUrl) ? false : true;
      render();
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

    var lines = [
      meta.index + "/9 " + meta.label,
      "时间: " + meta.time.local,
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
    context.font = "700 " + fontSize + "px Arial, Microsoft YaHei, sans-serif";
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

  function capturePhoto() {
    if (!stream || !video.videoWidth || !video.videoHeight) {
      setMessage("摄像头还没有准备好，请稍等。");
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
      browserUserAgent: navigator.userAgent,
      proofMode: "camera-only-9-photos",
      fileUploadDisabled: true
    };

    canvas.width = width;
    canvas.height = height;

    var context = canvas.getContext("2d");
    context.drawImage(video, 0, 0, width, height);
    drawWatermark(context, width, height, meta);

    photos[currentIndex].imageDataUrl = canvas.toDataURL("image/jpeg", jpegQuality);
    photos[currentIndex].metadata = meta;

    if (!isComplete()) {
      var nextMissing = photos.findIndex(function (item) {
        return !item.imageDataUrl;
      });
      currentIndex = nextMissing >= 0 ? nextMissing : currentIndex;
      showCurrentLiveCamera();
    } else {
      preview.src = photos[currentIndex].imageDataUrl;
      preview.hidden = false;
      video.hidden = true;
      sendCurrentValue();
    }

    render();
  }

  function retakeCurrent() {
    photos[currentIndex].imageDataUrl = "";
    photos[currentIndex].metadata = null;
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
        message: "请先完成 9 张指定角度照片。"
      });
      return;
    }

    window.JFCustomWidget.sendSubmit({
      valid: true,
      value: buildValue()
    });
  }

  startCameraButton.addEventListener("click", startCamera);
  captureButton.addEventListener("click", capturePhoto);
  retakeButton.addEventListener("click", retakeCurrent);
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

  render();
  resizeWidget();
})();
