const { v5 : uuidv5 } =  require('uuid');
function userFromContext({awsRequestId, invokedFunctionArn, functionName, functionVersion, identity, clientContext}) {
    const namespace = uuidv5("https://aws.amazon.com/request-id", uuidv5.URL)
    const key = uuidv5(awsRequestId, namespace)
    const ldUser = {
        key,
        custom: Object.assign({
            'request': key,
            'lambda-function-arn': invokedFunctionArn,
            'lambda-function-name': functionName,
            'lambda-function-version': functionVersion,
        })
    }
    if (!!identity) {
        const { cognitoIdentityId, cognitoIdentityPoolId} = identity
        Object.assign(ldUser.custom, {
            'cognito-identity-id': cognitoIdentityId,
            'cognito-identity-pool-id': cognitoIdentityPoolId
        })
    }
    if (!!clientContext) {
        const {client, env} = clientContext
        
        function snakeToKebab(key) {
            return key.split('_').map(v => v.toLowerCase()).join('-')
        }
        
        function toLDAttributes(object) {
            return Object.fromEntries(Object.entries(object)
                .map(([key, value]) => [`client-${snakeToKebab(prefix, key)}`, value])
                )
        }

        Object.assign(ldUser.custom, toLDAttributes(client), toLDAttributes(env))
    }
    return ldUser
}

module.exports = {
    userFromContext
}