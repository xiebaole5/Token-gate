/* =============================================================================
 * main.js - Token音乐盒
 *
 * 职责：
 *   1. 启动屏 -> 初始化 AudioContext + 粒子
 *   2. 曲库渲染 + 播放链路
 *   3. 音乐创作：输入想法 -> 后端生成 -> 入库播放
 *   4. 歌词展示：播放时逐行高亮
 *   5. Token 水银柱：TokenGate SSE 实时数据
 * ========================================================================== */

(function () {
  'use strict';

  // ---- DOM 引用 ----
  var splash = document.getElementById('splash');
  var splashBtn = document.getElementById('splashBtn');
  var app = document.getElementById('app');
  var bg = document.getElementById('bg');
  var audio = document.getElementById('audio');
  var songList = document.getElementById('songList');
  var songCount = document.getElementById('songCount');
  var playBtn = document.getElementById('playBtn');
  var pbName = document.getElementById('pbName');
  var pbIdea = document.getElementById('pbIdea');
  var pbCurrentTime = document.getElementById('pbCurrentTime');
  var pbTotalTime = document.getElementById('pbTotalTime');
  var pbBar = document.getElementById('pbBar');
  var pbBarFill = document.getElementById('pbBarFill');
  var volumeSlider = document.getElementById('volumeSlider');
  var nowplaying = document.getElementById('nowplaying');

  // 音乐创作 DOM
  var makeInput = document.getElementById('makeInput');
  var makeBtn = document.getElementById('makeBtn');
  var instrumentalToggle = document.getElementById('instrumentalToggle');
  var creatingCard = document.getElementById('creatingCard');
  var lyricsTextarea = document.getElementById('lyricsTextarea');
  var lyricsWrap = document.getElementById('lyricsWrap');
  var modeToggle = document.getElementById('modeToggle');
  var modeLabel = document.getElementById('modeLabel');

  // 歌词 DOM
  var lyricsOverlay = document.getElementById('lyricsOverlay');
  var lyricsLine0 = document.getElementById('lyricsLine0');
  var lyricsLine1 = document.getElementById('lyricsLine1');
  var lyricsLine2 = document.getElementById('lyricsLine2');

  // 水银柱 DOM
  var mercury = document.getElementById('mercury');
  var thermoValue = document.getElementById('thermoValue');
  var bulbInner = document.getElementById('bulbInner');
  var thermoHistory = document.getElementById('thermoHistory');
  var stageCenter = document.getElementById('stageCenter');

  // ---- 状态 ----
  var particleScene = null;
  var audioReceiver = null;
  var songs = [];
  var currentSongIndex = -1;
  var isPlaying = false;
  var audioInitialized = false;
  var customSongs = [];
  var isCreating = false;

  // 歌词状态
  var currentLyrics = [];
  var currentLyricLine = 0;

  // ---- Token 水银柱状态 ----
  var tokenConsumed = 0;
  var tokenPeak = 1;
  var tokenHistory = [];
  var tokenHistoryMax = 20;
  var tokenDisplay = 0;
  var sseSource = null;
  var TOKENGATE_BASE = ''; // 同源时用相对路径，独立运行时填 'http://127.0.0.1:8787'

  // 音乐创作后端地址（P2 规范）
  var MUSIC_BASE_URL = ''; // 走 TokenGate 代理，同源时用相对路径

  // ---- 工具函数 ----
  function formatTime(sec) {
    if (!sec || isNaN(sec)) return '0:00';
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' + s : s);
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ---- buildAudioGraph ----
  function buildAudioGraph() {
    if (audioInitialized) return;
    audioReceiver = new AudioReceiver(audio);
    audioReceiver.init();
    audioReceiver.resume();
    audioInitialized = true;
  }

  // ---- 粒子场景初始化 ----
  function initParticles() {
    particleScene = new ParticleScene(bg);
    particleScene.setForm('wave');

    if (window.ResizeObserver) {
      var ro = new ResizeObserver(function () {
        if (particleScene) particleScene.resize();
      });
      ro.observe(bg);
    } else {
      window.addEventListener('resize', function () {
        if (particleScene) particleScene.resize();
      });
    }
  }

  // ---- TokenGate 真实数据 ----
  var tokenGateRetries = 0;
  var tokenGateMaxRetries = 3;
  function connectTokenGate() {
    fetch(TOKENGATE_BASE + '/api/usages', { mode: 'cors' })
      .then(function (r) {
        if (!r.ok) throw new Error('status ' + r.status);
        return r.text();
      })
      .then(function (text) {
        if (!text) throw new Error('empty response');
        return JSON.parse(text);
      })
      .then(function (data) {
        tokenGateRetries = 0;
        if (data.usages && data.usages.length > 0) {
          var recent = data.usages.slice(-tokenHistoryMax);
          recent.forEach(function (u) {
            var tokens = (u.inputTokens || 0) + (u.outputTokens || 0);
            tokenHistory.push(tokens);
            if (tokens > tokenPeak) tokenPeak = tokens;
          });
          var last = recent[recent.length - 1];
          if (last) {
            tokenConsumed = (last.inputTokens || 0) + (last.outputTokens || 0);
          }
          updateThermometer();
        }
      })
      .catch(function () {
        tokenGateRetries++;
        if (tokenGateRetries <= tokenGateMaxRetries) {
          setTimeout(connectTokenGate, 5000);
        }
      });

    if (typeof EventSource !== 'undefined' && tokenGateRetries < tokenGateMaxRetries) {
      try {
        sseSource = new EventSource(TOKENGATE_BASE + '/api/stream');

        sseSource.addEventListener('usage', function (evt) {
          try {
            var u = JSON.parse(evt.data);
            var tokens = (u.inputTokens || 0) + (u.outputTokens || 0);
            tokenConsumed = tokens;
            if (tokens > tokenPeak) tokenPeak = tokens;
            tokenHistory.push(tokens);
            if (tokenHistory.length > tokenHistoryMax) tokenHistory.shift();
            updateThermometer();
          } catch (e) {}
        });

        sseSource.addEventListener('hello', function () {
          tokenGateRetries = 0;
        });

        sseSource.onerror = function () {
          if (sseSource) sseSource.close();
          if (tokenGateRetries < tokenGateMaxRetries) {
            setTimeout(connectTokenGate, 5000);
          }
        };
      } catch (e) {}
    }
  }

  // ---- 水银柱 UI ----
  function updateThermometer() {
    tokenDisplay += (tokenConsumed - tokenDisplay) * 0.3;
    var pct = Math.min(100, (tokenDisplay / tokenPeak) * 100);
    if (mercury) mercury.style.height = pct + '%';
    if (thermoValue) thermoValue.textContent = Math.round(tokenDisplay).toLocaleString();

    var color;
    if (pct < 33) color = '#10b981';
    else if (pct < 66) color = '#fbbf24';
    else color = '#ef4444';

    if (thermoValue) thermoValue.style.color = color;
    if (bulbInner) {
      bulbInner.style.background = color;
      bulbInner.style.color = color;
    }
    renderHistoryBars(color);
  }

  function renderHistoryBars(currentColor) {
    if (!thermoHistory) return;
    thermoHistory.innerHTML = '';
    var maxVal = Math.max.apply(null, tokenHistory.concat([1]));
    for (var i = 0; i < tokenHistory.length; i++) {
      var bar = document.createElement('div');
      bar.className = 'thermo-bar';
      var h = (tokenHistory[i] / maxVal) * 100;
      bar.style.height = Math.max(2, h) + '%';
      if (i === tokenHistory.length - 1) {
        bar.style.background = currentColor;
        bar.style.opacity = '1';
      } else {
        var age = (tokenHistory.length - i) / tokenHistory.length;
        bar.style.opacity = String(0.3 + (1 - age) * 0.5);
      }
      thermoHistory.appendChild(bar);
    }
  }

  // ---- 渲染循环 ----
  function renderLoop() {
    requestAnimationFrame(renderLoop);
    if (!particleScene) return;

    var audioData = { bass: 0, mid: 0, treble: 0, beat: 0, energy: 0, centroid: 0 };
    if (audioReceiver && audioInitialized) {
      audioData = audioReceiver.analyze();
    }

    var tokenData = { consumed: tokenDisplay, peak: tokenPeak, history: tokenHistory };
    particleScene.update(audioData, tokenData);

    // 更新进度条
    if (audio.duration && isPlaying) {
      var pct = (audio.currentTime / audio.duration) * 100;
      pbBarFill.style.width = pct + '%';
      pbCurrentTime.textContent = formatTime(audio.currentTime);

      // 更新歌词
      updateLyrics();
    }
  }

  // ---- 歌词更新 ----
  function updateLyrics() {
    if (currentLyrics.length === 0 || !audio.duration) return;

    // 按总时长对行数加权分配
    var lineIndex = Math.floor((audio.currentTime / audio.duration) * currentLyrics.length);
    if (lineIndex >= currentLyrics.length) lineIndex = currentLyrics.length - 1;

    if (lineIndex !== currentLyricLine) {
      currentLyricLine = lineIndex;
      renderLyrics();
    }
  }

  function renderLyrics() {
    if (currentLyrics.length === 0) {
      lyricsOverlay.style.display = 'none';
      return;
    }
    lyricsOverlay.style.display = 'block';

    // Keep old 3-line elements updated (hidden compat)
    var prev = currentLyricLine > 0 ? currentLyrics[currentLyricLine - 1] : '';
    var curr = currentLyrics[currentLyricLine] || '';
    var next = currentLyricLine < currentLyrics.length - 1 ? currentLyrics[currentLyricLine + 1] : '';
    lyricsLine0.textContent = prev;
    lyricsLine1.textContent = curr;
    lyricsLine2.textContent = next;

    // New: render full lyrics list on left panel
    var lyricsList = document.getElementById('lyricsList');
    if (!lyricsList) return;

    // Build list if not yet built or line count changed
    if (lyricsList.children.length !== currentLyrics.length) {
      lyricsList.innerHTML = '';
      for (var i = 0; i < currentLyrics.length; i++) {
        var row = document.createElement('div');
        row.className = 'lyrics-row';
        row.innerHTML = '<span class="lyric-dot"></span><span class="lyric-text"></span>';
        row.querySelector('.lyric-text').textContent = currentLyrics[i];
        lyricsList.appendChild(row);
      }
    }

    // Update current highlight
    var rows = lyricsList.children;
    for (var j = 0; j < rows.length; j++) {
      rows[j].classList.toggle('current', j === currentLyricLine);
    }

    // Scroll to current line (center it)
    if (rows[currentLyricLine]) {
      var rowEl = rows[currentLyricLine];
      var panelHeight = lyricsList.parentElement.clientHeight || 400;
      var rowOffset = rowEl.offsetTop + rowEl.offsetHeight / 2;
      var scrollY = rowOffset - panelHeight / 2;
      lyricsList.style.transform = 'translateY(' + (-scrollY + 80) + 'px)';
    }
  }

  // ---- 加载曲库 ----
  function loadSongs() {
    try {
      var raw = localStorage.getItem('musicbox.songs');
      customSongs = raw ? JSON.parse(raw) : [];
      // 清理失效的 blob URL（刷新后 blob: 协议的 URL 已无效）
      var hadStale = false;
      customSongs = customSongs.filter(function (s) {
        if (s.blobUrl && s.blobUrl.indexOf('blob:') === 0) {
          hadStale = true;
          return false; // 移除带有失效 blob URL 的歌
        }
        return true;
      });
      if (hadStale) {
        localStorage.setItem('musicbox.songs', JSON.stringify(customSongs));
      }
    } catch (e) {
      customSongs = [];
    }

    fetch('cache/songs.json')
      .then(function (r) {
        if (!r.ok) throw new Error('status ' + r.status);
        return r.text();
      })
      .then(function (text) {
        if (!text) throw new Error('empty');
        return JSON.parse(text);
      })
      .then(function (data) {
        songs = data.songs || [];
        renderSongList();
      })
      .catch(function (e) {
        console.warn('加载 songs.json 失败:', e);
        songs = [];
        renderSongList();
      });
  }

  // ---- 渲染曲库列表 ----
  function renderSongList() {
    var allSongs = customSongs.concat(songs);
    songCount.textContent = allSongs.length + ' 首歌';
    songList.innerHTML = '';

    allSongs.forEach(function (song, idx) {
      var item = document.createElement('div');
      item.className = 'song-item';
      item.dataset.index = idx;

      var isNew = song.isNew ? '<span class="song-badge-new">新</span>' : '';
      var badge = '';
      if (song.isFallback) {
        badge = '<span class="song-badge-demo">演示样本</span>';
      } else if (song.isOriginal) {
        badge = '<span class="song-badge-original">原创词</span>';
      }

      item.innerHTML =
        '<span class="song-idx">' + (idx + 1) + '</span>' +
        '<div class="song-info">' +
          '<div class="song-name">' + escapeHtml(song.name) + '</div>' +
          '<div class="song-idea">' + escapeHtml(song.idea || '') + '</div>' +
        '</div>' +
        badge +
        isNew +
        '<span class="song-duration">' + formatTime(song.duration / 1000) + '</span>';

      item.addEventListener('click', function () {
        playSong(idx);
      });

      songList.appendChild(item);
    });
  }

  // ---- 播放指定歌曲 ----
  function playSong(index) {
    var song;
    if (index < customSongs.length) {
      song = customSongs[index];
    } else {
      song = songs[index - customSongs.length];
    }
    if (!song) return;

    currentSongIndex = index;

    if (song.blobUrl) {
      audio.src = song.blobUrl;
    } else if (song.audioPath) {
      audio.src = song.audioPath;
    } else {
      console.warn('歌曲没有音频文件:', song.name);
    }

    pbName.textContent = song.name;
    // 播放条显示来源徽章
    var pbBadge = '';
    if (song.isFallback) pbBadge = ' <span class="pb-badge pb-badge-demo">演示样本</span>';
    else if (song.isOriginal) pbBadge = ' <span class="pb-badge pb-badge-original">原创词</span>';
    pbName.innerHTML = escapeHtml(song.name) + pbBadge;
    pbIdea.textContent = song.idea || '';
    nowplaying.innerHTML = '正在播放 <strong>' + escapeHtml(song.name) + '</strong>';
    playBtn.disabled = false;

    // 隐藏中心提示
    if (stageCenter) stageCenter.classList.add('hidden');

    // 设置歌词
    if (song.lyrics && song.lyrics.trim()) {
      currentLyrics = song.lyrics.split('\n').filter(function (l) { return l.trim(); });
      currentLyricLine = 0;
      renderLyrics();
    } else {
      currentLyrics = [];
      lyricsOverlay.style.display = 'none';
    }

    // 高亮当前歌曲
    var items = songList.querySelectorAll('.song-item');
    items.forEach(function (el) {
      el.classList.toggle('active', parseInt(el.dataset.index) === index);
      el.classList.remove('playing');
    });

    if (particleScene) particleScene.setForm('wave');

    // 先绑定 metadata 监听，再 play（避免本地文件加载太快错过事件）
    audio.addEventListener('loadedmetadata', function onMeta() {
      pbTotalTime.textContent = formatTime(audio.duration);
      audio.removeEventListener('loadedmetadata', onMeta);
    });
    audio.addEventListener('durationchange', function onDur() {
      if (audio.duration && !isNaN(audio.duration)) {
        pbTotalTime.textContent = formatTime(audio.duration);
      }
      audio.removeEventListener('durationchange', onDur);
    });

    audio.play().then(function () {
      isPlaying = true;
      playBtn.textContent = '⏸';
      var activeItem = songList.querySelector('.song-item[data-index="' + index + '"]');
      if (activeItem) activeItem.classList.add('playing');
      // 兜底：play 成功后如果 duration 已知，立即更新
      if (audio.duration && !isNaN(audio.duration)) {
        pbTotalTime.textContent = formatTime(audio.duration);
      }
    }).catch(function (e) {
      console.warn('播放失败:', e);
    });
  }

  // ---- 播放/暂停 ----
  function togglePlay() {
    if (currentSongIndex < 0) return;
    if (isPlaying) {
      audio.pause();
      isPlaying = false;
      playBtn.textContent = '▶';
    } else {
      audio.play().then(function () {
        isPlaying = true;
        playBtn.textContent = '⏸';
      }).catch(function (e) {
        console.warn('播放失败:', e);
      });
    }
  }

  function seekTo(e) {
    if (!audio.duration) return;
    var rect = pbBar.getBoundingClientRect();
    var pct = (e.clientX - rect.left) / rect.width;
    audio.currentTime = pct * audio.duration;
    pbBarFill.style.width = (pct * 100) + '%';
  }

  function setVolume(e) {
    audio.volume = parseFloat(e.target.value);
  }

  function onEnded() {
    isPlaying = false;
    playBtn.textContent = '▶';
    var allSongs = customSongs.concat(songs);
    if (currentSongIndex >= 0 && currentSongIndex < allSongs.length - 1) {
      playSong(currentSongIndex + 1);
    }
  }

  // ============================================================
  // 音乐创作功能
  // ============================================================

  // 创作中文案轮播
  var createPhrases = ['在写词…', '在编曲…', '在录音棚唱了…', '在混音…', '快要好了…'];
  var phraseTimer = null;

  function startCreating() {
    var idea = makeInput.value.trim();
    if (!idea) return;

    var userLyrics = '';
    var isOriginalMode = false;
    if (lyricsTextarea && lyricsTextarea.value.trim()) {
      userLyrics = lyricsTextarea.value.trim();
      isOriginalMode = true;
    }

    isCreating = true;
    makeBtn.disabled = true;
    makeInput.disabled = true;
    if (lyricsTextarea) lyricsTextarea.disabled = true;
    makeBtn.textContent = '创作中…';

    // 显示创作中卡片
    creatingCard.style.display = 'block';
    creatingCard.className = 'creating-card';
    creatingCard.innerHTML =
      '<div class="creating-spinner"></div>' +
      '<div class="creating-text" id="creatingText">' + createPhrases[0] + '</div>' +
      '<div class="creating-elapsed" id="creatingElapsed">已等待 0 秒</div>';

    var phraseIdx = 0;
    var elapsed = 0;
    var creatingText = document.getElementById('creatingText');
    var creatingElapsed = document.getElementById('creatingElapsed');

    phraseTimer = setInterval(function () {
      elapsed++;
      if (creatingElapsed) creatingElapsed.textContent = '已等待 ' + elapsed + ' 秒';
      phraseIdx = Math.floor(elapsed / 8) % createPhrases.length;
      if (creatingText) creatingText.textContent = createPhrases[phraseIdx];
    }, 1000);

    // 粒子切星河形态
    if (particleScene) particleScene.setForm('galaxy');

    // 调用后端生成
    generateMusic(idea, instrumentalToggle.checked, isOriginalMode ? userLyrics : null);
  }

  function generateMusic(idea, instrumental, userLyrics) {
    var url = MUSIC_BASE_URL + '/api/v1/music/generate';

    var bodyObj = { idea: idea, instrumental: instrumental };
    if (userLyrics && userLyrics.trim()) {
      bodyObj.lyrics = userLyrics.trim();
    }

    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyObj),
    })
      .then(function (res) {
        if (!res.ok) throw new Error('生成失败: ' + res.status);
        var durationMs = parseInt(res.headers.get('X-Music-Duration-Ms')) || 30000;
        var lyricsHeader = res.headers.get('X-Music-Lyrics');
        var realLyrics = '';
        if (lyricsHeader) {
          try {
            realLyrics = decodeURIComponent(lyricsHeader);
          } catch (e) {
            realLyrics = lyricsHeader;
          }
        }
        var source = res.headers.get('X-Music-Source') || 'minimax';
        return res.blob().then(function (blob) {
          return { blob: blob, durationMs: durationMs, lyrics: realLyrics, source: source };
        });
      })
      .then(function (result) {
        onMusicCreated(idea, instrumental, result.blob, result.durationMs, false, result.lyrics, result.source, !!userLyrics);
      })
      .catch(function (e) {
        console.warn('[创作] 生成失败，使用本地合成:', e.message);
        // 降级：本地生成一段示例音频
        fallbackGenerate(idea, instrumental, !!userLyrics);
      });
  }

  // 本地降级生成（后端不可用时）
  function fallbackGenerate(idea, instrumental, isOriginal) {
    // 用之前生成的 demo 音频作为占位
    var demoFiles = ['cache/demo-1.wav', 'cache/demo-2.wav', 'cache/demo-3.wav'];
    var randomFile = demoFiles[Math.floor(Math.random() * demoFiles.length)];

    fetch(randomFile)
      .then(function (r) { return r.blob(); })
      .then(function (blob) {
        // fallback 不显示歌词（没有真词，绝不冒充生成结果）
        onMusicCreated(idea, instrumental, blob, 30000, true, '', 'demo', isOriginal);
      })
      .catch(function (e) {
        finishCreating();
        alert('创作失败：' + e.message);
      });
  }

  function onMusicCreated(idea, instrumental, blob, durationMs, isFallback, realLyrics, source, isOriginal) {
    var blobUrl = URL.createObjectURL(blob);
    var songName = idea.substring(0, 20);

    // 歌词来源：
    // - 真实生成（source=minimax）：用后端返回的真词（realLyrics）
    // - 自己写模式（isOriginal）：用用户原文（在 startCreating 时已传入后端，后端原样返回）
    // - 纯音乐：无歌词
    // - fallback 降级：无歌词（绝不冒充）
    var lyrics = '';
    if (!instrumental && !isFallback) {
      lyrics = realLyrics || '';
    }

    var newSong = {
      id: 'custom-' + Date.now(),
      name: songName,
      idea: idea,
      duration: durationMs,
      blobUrl: blobUrl,
      lyrics: lyrics,
      createdAt: new Date().toISOString(),
      instrumental: instrumental,
      isNew: true,
      isFallback: isFallback || false,
      isOriginal: isOriginal || false,
      source: source || 'minimax',
    };

    customSongs.unshift(newSong);
    localStorage.setItem('musicbox.songs', JSON.stringify(customSongs));

    finishCreating();

    // 粒子切回波浪
    if (particleScene) particleScene.setForm('wave');

    renderSongList();

    // 自动播放新歌
    playSong(0);

    // 3 秒后移除新徽章
    setTimeout(function () {
      newSong.isNew = false;
      localStorage.setItem('musicbox.songs', JSON.stringify(customSongs));
      renderSongList();
    }, 3000);
  }

  function finishCreating() {
    isCreating = false;
    makeBtn.disabled = false;
    makeInput.disabled = false;
    if (lyricsTextarea) lyricsTextarea.disabled = false;
    makeBtn.textContent = '做一首';
    creatingCard.style.display = 'none';
    if (phraseTimer) {
      clearInterval(phraseTimer);
      phraseTimer = null;
    }
  }

  // ============================================================
  // 启动
  // ============================================================

  splashBtn.addEventListener('click', function () {
    splash.classList.add('hidden');
    setTimeout(function () {
      app.classList.add('visible');
      initParticles();
      buildAudioGraph();
      renderLoop();
      connectTokenGate();
      audio.volume = parseFloat(volumeSlider.value);

      // 启用创作按钮
      makeBtn.disabled = false;
    }, 300);
  });

  playBtn.addEventListener('click', togglePlay);
  pbBar.addEventListener('click', seekTo);
  volumeSlider.addEventListener('input', setVolume);
  audio.addEventListener('ended', onEnded);

  // 创作按钮
  makeBtn.addEventListener('click', function () {
    if (!isCreating) startCreating();
  });

  // 回车提交
  makeInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !isCreating && makeInput.value.trim()) {
      startCreating();
    }
  });

  // 「一句话灵感 / 自己写」模式切换
  if (modeToggle) {
    modeToggle.addEventListener('click', function () {
      var isAdvanced = lyricsWrap.classList.toggle('visible');
      if (isAdvanced) {
        modeLabel.textContent = '一句话灵感';
        makeInput.placeholder = '描述曲风，比如：下雨的夜晚 温柔的钢琴';
      } else {
        modeLabel.textContent = '自己写';
        makeInput.placeholder = '说一个想法，我唱给你听--比如：下雨的夜晚 温柔的钢琴';
        if (lyricsTextarea) lyricsTextarea.value = '';
      }
    });
  }

  // 预加载曲库
  loadSongs();

  // ============================================================
  // 导航切换 + 音频数值面板
  // ============================================================

  // Nav 切换
  var navItems = document.querySelectorAll('.nav-item[data-view]');
  navItems.forEach(function (item) {
    item.addEventListener('click', function () {
      var view = item.getAttribute('data-view');
      navItems.forEach(function (n) { n.classList.remove('active'); });
      item.classList.add('active');

      // 关闭所有面板
      var panels = document.querySelectorAll('.overlay-panel');
      panels.forEach(function (p) { p.style.display = 'none'; });

      if (view === 'library') {
        document.getElementById('libraryPanel').style.display = 'flex';
      } else if (view === 'create') {
        document.getElementById('createPanel').style.display = 'flex';
      }
    });
  });

  // 面板关闭按钮
  document.querySelectorAll('.panel-close').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var target = btn.getAttribute('data-close');
      if (target) document.getElementById(target).style.display = 'none';
      // 恢复 viz 导航激活
      navItems.forEach(function (n) { n.classList.remove('active'); });
      document.querySelector('.nav-item[data-view="viz"]').classList.add('active');
    });
  });

  // 音频数值实时更新
  var meterBass = document.getElementById('meterBass');
  var meterMid = document.getElementById('meterMid');
  var meterTreble = document.getElementById('meterTreble');
  var meterEnergy = document.getElementById('meterEnergy');

  function updateAudioMeters() {
    if (audioReceiver && typeof audioReceiver.analyze === 'function') {
      var data = audioReceiver.analyze();
      if (meterBass) meterBass.textContent = (data.bass || 0).toFixed(2);
      if (meterMid) meterMid.textContent = (data.mid || data.mids || 0).toFixed(2);
      if (meterTreble) meterTreble.textContent = (data.treble || 0).toFixed(2);
      if (meterEnergy) meterEnergy.textContent = (data.energy || 0).toFixed(2);
    }
    requestAnimationFrame(updateAudioMeters);
  }
  updateAudioMeters();

  // 导出
  window.MusicBox = {
    getAudio: function () { return audio; },
    getAudioReceiver: function () { return audioReceiver; },
    getParticleScene: function () { return particleScene; },
    getSongs: function () { return customSongs.concat(songs); },
    addCustomSong: function (song) {
      customSongs.unshift(song);
      localStorage.setItem('musicbox.songs', JSON.stringify(customSongs));
      renderSongList();
    },
    buildAudioGraph: buildAudioGraph,
    getTokenData: function () { return { consumed: tokenDisplay, peak: tokenPeak, history: tokenHistory }; },
    getTokenGateStatus: function () { return sseSource ? sseSource.readyState : -1; },
  };
})();
