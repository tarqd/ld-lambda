const ld = require("launchdarkly-node-server-sdk");

const { performance } = require("perf_hooks");

const globalInstance = {
  client: null,
  ready: null,
};

async function getLDClient() {
  const { client, ready } = globalInstance;
  if (client === null || ready === null) {
    throw new Error("getLDCLient() was called before initializeLaunchDarkly()");
  }
  await ready;
  return client;
}

function initializeLaunchDarklyWithTimeout(
  sdkKey,
  initTimeout,
  additionalOptions
) {
  const { LD_INIT_TIMEOUT } = process.env;
  const timeout = +LD_INIT_TIMEOUT || initTimeout || 1000;

  const options = Object.assign(getLDConfig(), additionalOptions);
  client = initializeWithMetrics(sdkKey, options);
  ready = waitForInitializationWithTimeout(client, timeout);
  Object.assign(globalInstance, { client, ready });
  return client;
}

async function waitForInitializationWithTimeout(ldClient, initTimeout) {
  try {
    const clientReady = await deadline(
      ldClient.waitForInitialization(),
      initTimeout
    );
  } catch (e) {
    if (e instanceof DeadlineError) {
      console.log(
        "[LaunchDarkly] Initialization timed out. Flags will return fallback values until initialization completes",
        e
      );
    } else {
      // we want to continue anyway
      console.error(e);
    }
  }

  return ldClient;
}

function initializeWithMetrics(sdkKey, options = {}) {
  const { useLDD } = options;
  const perfOptions = { details: { useLDD } };

  const initStarted = performance.mark("launchdarkly:initStarted", perfOptions);
  const ldClient = ld.init(sdkKey, options);

  performance.measure(
    "launchdarkly:timeToInitStart",
    performance.nodeTiming.nodeStart
  );
  async function recordInitLatency(ldClient) {
    try {
      await ldClient.waitForInitialization();
      const initComplete = performance.mark(
        "launchdarkly:initComplete",
        perfOptions
      );
      performance.measure(
        "launchdarkly:initLatency",
        "launchdarkly:initStarted"
      );
      performance.measure(
        "launchdarkly:timeToInitComplete",
        performance.nodeTiming.nodeStart
      );
      console.info(
        `[LaunchDarkly] Initialization successful! ${
          useLDD
            ? "The persistent store is available"
            : "Flags are now available."
        }`
      );
    } catch (e) {
      const initFailed = performance.mark("launchdarkly:initComplete", {
        detail: { success: false, error: e },
      });
      performance.measure(
        "launchdarkly:initLatency",
        "launchdarkly:initStarted"
      );
      performance.measure(
        "launchdarkly:timeToInitComplete",
        performance.nodeTiming.nodeStart
      );
      console.error(
        "[LaunchDarkly] Initialization failed permanently. Flags will return fallback values",
        e
      );
    }
  }
  // do not await, we want to return ldClient immediately
  recordInitLatency(ldClient);
  return ldClient;
}

function getLDConfig() {
  const {
    LD_RELAY_URI,
    LD_EVENT_URI,
    LD_BASE_URI,
    LD_STREAM_URI,
    LD_STREAM_INITIAL_RECONNECT_DELAY,
    LD_CONNECT_TIMEOUT,
    LD_LOG_LEVEL,
    NODE_ENV,
    LD_USE_DAEMON_MODE,
    LD_STORE_URI,
    LD_STORE_PREFIX,
    LD_STORE_CACHE_TTL,
    LOG_LEVEL,
    LD_EVENT_FLUSH_INTERVAL,
    LD_EVENT_CAPACITY,
  } = process.env;
  const useDaemonMode = !!LD_USE_DAEMON_MODE;

  function parseIntIfNotEmpty(str, fallbackValue) {
    if (str && str.length > 0) {
      return parseInt(str, 10);
    }
    return fallbackValue;
  }
  function endpointConfig() {
    return {
      eventsUri: LD_EVENT_URI || LD_RELAY_URI || null,
      baseUri: LD_BASE_URI || LD_RELAY_URI || null,
      streamUri: LD_STREAM_URI || LD_RELAY_URI || null,
    };
  }
  function daemonModeConfig() {
    if (!useDaemonMode) return;

    const storeUri = new URL(LD_STORE_URI);
    let featureStore;
    const cacheTTL = parseIntIfNotEmpty(LD_STORE_CACHE_TTL, null);
    const keyPrefix = LD_STORE_PREFIX;
    const table = LD_STORE_TABLE_NAME;
    const supportedProtocols = ["redis", "rediss", "dynamodb"];
    const protocol = storeUri.protocol;

    if (!supportedProtocols.includes(protocol)) {
      throw new Error(`Unsupported protocol '${protocol}' in LD_STORE_URI.`);
    }

    if (protocol === "redis" || protocol === "rediss") {
      const {
        RedisFeatureStore,
      } = require("launchdarkly-node-server-sdk-redis");
      featureStore = new RedisFeatureStore({
        cacheTTL,
        prefix,
        redisOpts: { url: storeUri.toString() },
      });
    }

    if (protocol == "dynamodb") {
      const {
        DynamoDBFeatureStore,
      } = require("launchdarkly-node-server-sdk-dynamodb");
      featureStore = new DynamoDBFeatureStore(storeUri.pathname, {
        cacheTTL,
        prefix,
        clientOptions: Object.fromEntries(storeUri.searchParams.entries()),
      });
    }
    console.debug(
      "[LaunchDarkkly] Using daemon mode. Flags/segments will be fetched on-demand during evaluation from ",
      protocol,
      " and cached for ",
      cacheTTL,
      " seconds"
    );
    console.debug(
      "[LaunchDarkkly] No streaming or polling connection will be established."
    );

    return {
      useLDD: useDaemonMode,
      featureStore,
    };
  }

  function eventConfig() {
    return {
      capacity: parseIntIfNotEmpty(LD_EVENT_CAPACITY, null),
      flushInterval: parseIntIfNotEmpty(LD_EVENT_FLUSH_INTERVAL, null),
    };
  }

  function loggingConfig() {
    const defaultEnvLogLevel = NODE_ENV == "production" ? "info" : "debug";
    const level = LD_LOG_LEVEL || LOG_LEVEL || defaultEnvLogLevel;
    return {
      logger: ld.basicLogger({ level }),
    };
  }

  function streamConfig() {
    return {
      streamInitialReconectDelay: LD_STREAM_INITIAL_RECONNECT_DELAY,
    };
  }

  return Object.assign(
    {},
    loggingConfig(),
    endpointConfig(),
    daemonModeConfig(),
    eventConfig(),
    streamConfig()
  );
}

class DeadlineError extends Error {
  constructor() {
    super("Deadline");
    this.name = "DeadlineError";
  }
}

function deadline(promise, timeoutDuration) {
  let timeoutHandle;
  const timeout = new Promise((resolve, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new DeadlineError()),
      timeoutDuration
    );
  });

  return Promise.race([timeout, promise]).finally(function () {
    clearTimeout(timeoutHandle);
  });
}

module.exports = {
  initializeLaunchDarklyWithTimeout,
  getLDClient,
};
