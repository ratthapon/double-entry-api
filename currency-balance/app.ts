import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDB } from 'aws-sdk';
import { PutRequest, BatchWriteItemInput, DocumentClient, QueryOutput, QueryInput } from 'aws-sdk/clients/dynamodb';
import { randomUUID } from 'crypto';

let TRANSACTION_TABLE: string = process.env.TRANSACTION_TABLE ??= "TransactionTable"
let BALANCESTATE_TABLE: string = process.env.BALANCESTATE_TABLE ??= "BalanceStateTable"

const dynamo = new DynamoDB.DocumentClient();
const ddb = new DynamoDB({ apiVersion: '2012-08-10' });


interface BalanceState {
    id?: string,            // object id
    uid: string,           // uid uid
    assetName: string,     // asset class
    amount: string,        // amount
    account: string,       // double entry account 
    entryType: string      // Credit: CR , Debit: DR
}

interface InitBalanceStateRequest {
    asset: string,
    uid: string,
}

interface GetBalanceStateRequest {
    asset: string,
    uid: string,
    amount: string,
    account: string,
    entryType: string
}

interface BalanceResponse {
    total: number | null,
    DR: QueryOutput,
    CR: QueryOutput
}

const mapBalanceStateToID = (balanceState: BalanceState) => {
    return `${balanceState.uid}_${balanceState.account}_${balanceState.assetName}_${balanceState.entryType}`
}

const mapBalanceStateToPutRequest = (balanceState: BalanceState): PutRequest => {
    return {
        Item: {
            "id": { "S": mapBalanceStateToID(balanceState) },
            "uid": { "S": balanceState.uid },
            "assetName": { "S": balanceState.assetName },
            "amount": { "N": balanceState.amount },
            "account": { "S": balanceState.account },
            "entryType": { "S": balanceState.entryType }
        }
    }
}

const initBalanceState = async (requestBody: InitBalanceStateRequest): Promise<BalanceState[]> => {
    let assetDRState: BalanceState = {
        uid: requestBody.uid,
        assetName: requestBody.asset,
        amount: '0',
        account: 'ASSET',
        entryType: 'DR'
    }

    let assetCRState: BalanceState = {
        uid: requestBody.uid,
        assetName: requestBody.asset,
        amount: '0',
        account: 'ASSET',
        entryType: 'CR'
    }

    let params: BatchWriteItemInput = {
        RequestItems: {
            "BalanceStateTable": [
                { PutRequest: mapBalanceStateToPutRequest(assetDRState) },
                { PutRequest: mapBalanceStateToPutRequest(assetCRState) },
            ]
        }
    };

    console.log("batchWriteItem", params)
    await ddb.batchWriteItem(params).promise();
    return [assetDRState, assetCRState]
}

const getBalanceState = async (requestBody: GetBalanceStateRequest): Promise<BalanceResponse> => {
    let balanceState: BalanceState = {
        uid: requestBody.uid,
        assetName: requestBody.asset,
        amount: requestBody.amount,
        account: requestBody.account,
        entryType: requestBody.entryType
    }

    let drParams: QueryInput = {
        TableName: BALANCESTATE_TABLE,
        FilterExpression: 'uid = :uid AND assetName = :assetName AND account = :account AND entryType = :entryType',
        ExpressionAttributeValues: {
            // ":parsedId": { "S": mapBalanceStateToID(balanceState) },
            ":uid": { "S": balanceState.uid },
            ":assetName": { "S": balanceState.assetName },
            ":account": { "S": balanceState.account },
            ":entryType": { "S": "DR" }
        },
    };
    console.log("query", drParams)
    let drBalanceState = await ddb.scan(drParams).promise();

    let crParams: QueryInput = {
        TableName: BALANCESTATE_TABLE,
        FilterExpression: 'uid = :uid AND assetName = :assetName AND account = :account AND entryType = :entryType',
        ExpressionAttributeValues: {
            // ":parsedId": { "S": mapBalanceStateToID(balanceState) },
            ":uid": { "S": balanceState.uid },
            ":assetName": { "S": balanceState.assetName },
            ":account": { "S": balanceState.account },
            ":entryType": { "S": "CR" }
        },
    };
    console.log("query", crParams)
    let crBalanceState = await ddb.scan(crParams).promise();

    let total: number | null  = null
    try {
        if (drBalanceState !== undefined && crBalanceState != undefined ) {
            total = drBalanceState.Items[0].amount.N  -  crBalanceState.Items[0].amount.N
        }
    } catch (error) {
        
    }
    
    return {
        "total": total,
        "DR": drBalanceState,
        "CR": crBalanceState
    }
}


export const lambdaHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    // All log statementimestamp are written to CloudWatch
    console.info('received:', event);


    let response: APIGatewayProxyResult;
    if (event.httpMethod == "POST") {
        let dbresponse;
        const body: InitBalanceStateRequest = JSON.parse(event.body as string);
        try {
            console.log("Init accounts with request:", body)
            dbresponse = await initBalanceState(body)
            console.log("Init with txs: ", dbresponse)
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
    } else if (event.httpMethod == "GET") {
        try {
            let queryParams = event.queryStringParameters as unknown as GetBalanceStateRequest
            console.log("Get balance with request:", queryParams)
            let dbresponse = await getBalanceState(queryParams)
            console.log("Get balance with txs: ", dbresponse)
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
                message: `Method Not Allowed: expect GET, POST, received ${event.httpMethod}`,
            }),
        };
    }
};
