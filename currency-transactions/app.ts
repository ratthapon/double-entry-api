import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDB } from 'aws-sdk';
import { QueryInput, QueryOutput } from 'aws-sdk/clients/dynamodb';

let TRANSACTION_TABLE: string = process.env.TRANSACTION_TABLE ??= "TransactionTable"

const dynamo = new DynamoDB.DocumentClient();
const ddb = new DynamoDB({ apiVersion: '2012-08-10' });


interface Transaction {
    id: string,            // object id
    txid: string,          // transaction id
    uid: string,         // owner uid
    assetName: string,     // asset class
    ts: string,            // timestamp
    amount: string,        // amount
    account: string,       // double entry account 
    entryType: string      // Credit: CR , Debit: DR
}

interface TransactionsRequest {
    uid?: string,
    asset?: string,
    account?: string,
    limit?: number,
}

const getTransaction = async (requestBody: TransactionsRequest): Promise<QueryOutput> => {
    let params: QueryInput = {
        TableName: TRANSACTION_TABLE,
        FilterExpression: 'uid = :uid AND assetName = :asset AND account = :account',
        Limit: requestBody.limit,
        ExpressionAttributeValues: {
            ":uid": { "S": requestBody.uid },
            ":asset": { "S": requestBody.asset },
            ":account": { "S": requestBody.account }
        },
        ReturnConsumedCapacity: "TOTAL"
    };

    console.log("query", params)
    let results = ddb.scan(params).promise();
    return results
}

export const lambdaHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    // All log statementimestamp are written to CloudWatch
    console.info('received:', event);

    let q_uid = event.queryStringParameters != null? event.queryStringParameters.uid: ""
    let q_asset = event.queryStringParameters != null? event.queryStringParameters.asset: "GEM"
    let q_account = event.queryStringParameters != null? event.queryStringParameters.account: "ASSET"
    let q_limit = event.queryStringParameters != null? event.queryStringParameters.limit: "10000000"

    let response: APIGatewayProxyResult;
    if (event.httpMethod == "GET") {
        let dbresponse;
        const body: TransactionsRequest = {
            uid: q_uid,
            asset: q_asset,
            account: q_account,
            limit: Number(q_limit)
        }
        try {
            console.log("Init GetTransaction with request:", body)
            dbresponse = await getTransaction(body)
            console.log("GetTransaction", dbresponse)
            response = {
                statusCode: 200,
                body: JSON.stringify(dbresponse)
            };
        } catch (err) {
            console.log(err);
            response = {
                statusCode: 500,
                body: JSON.stringify({
                    message: 'some error happened',
                }),
            };
        }
        return response;
    } else {
        return {
            statusCode: 405,
            body: JSON.stringify({
                message: `Method Not Allowed: expect GET, received ${event.httpMethod}`,
            }),
        };
    }
};
