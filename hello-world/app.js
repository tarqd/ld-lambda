const {
  initializeLaunchDarklyWithTimeout,
  getLDClient,
} = require("./launchdarkly");
const { userFromContext } = require("./user");

initializeLaunchDarklyWithTimeout(process.env.LD_SDK_KEY, 1000);

/**
 *
 * Event doc: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html#api-gateway-simple-proxy-for-lambda-input-format
 * @param {Object} event - API Gateway Lambda Proxy Input Format
 *
 * Context doc: https://docs.aws.amazon.com/lambda/latest/dg/nodejs-prog-model-context.html
 * @param {Object} context
 *
 * Return doc: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html
 * @returns {Object} object - API Gateway Lambda Proxy Output Format
 *
 */
exports.lambdaHandler = async (event, context) => {
  const ldClient = await getLDClient();
  const user = userFromContext(context);
  const widgetAvailable = await isWidgetAvailableFor(user);
  const response = {
    statusCode: 200,
    body: {
      user,
      "release-widget": widgetAvailable,
    },
  };

  ldClient.flush();
  return response;
};

async function isWidgetAvailableFor(user) {
  const ldClient = await getLDClient();
  return ldClient.variation("release-widget", user, false);
}
