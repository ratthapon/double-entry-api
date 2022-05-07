import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDB } from 'aws-sdk';
import { PutRequest, BatchWriteItemInput, DocumentClient } from 'aws-sdk/clients/dynamodb';
import { randomUUID } from 'crypto';

let TRANSACTION_TABLE: string = process.env.TRANSACTION_TABLE ??= "TransactionTable"

const dynamo = new DynamoDB.DocumentClient();
const ddb = new DynamoDB({ apiVersion: '2012-08-10' });


interface Transaction {
    id: string,            // object id
    txid: string,          // transaction id
    uid: string,         // uid uid
    assetName: string,     // asset class
    ts: string,            // timestamp
    amount: string,        // amount
    account: string,       // double entry account 
    entryType: string      // Credit: CR , Debit: DR
}

interface BalanceState {
    id?: string,            // object id
    uid: string,           // uid uid
    assetName: string,     // asset class
    amount: string,        // amount
    account: string,       // double entry account 
    entryType: string      // Credit: CR , Debit: DR
}

interface FundRequest {
    asset: string,
    to: string,
    amount: number,
}

const mapTransactionToPutRequest = (transaction: Transaction): PutRequest => {
    return {
        Item: {
            "id": { "S": transaction.id },
            "txid": { "S": transaction.txid },
            "uid": { "S": transaction.uid },
            "assetName": { "S": transaction.assetName },
            "ts": { "N": transaction.ts },
            "amount": { "N": transaction.amount },
            "account": { "S": transaction.account },
            "entryType": { "S": transaction.entryType }
        }
    }
}

const mapBalanceStateToID = (balanceState: BalanceState) => {
    return `${balanceState.uid}_${balanceState.account}_${balanceState.assetName}_${balanceState.entryType}`
}

const mapBalanceStateToPutItem = (balanceState: BalanceState): PutRequest => {
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

const fund = async (requestBody: FundRequest): Promise<Transaction[]> => {
    const txid: string = randomUUID()         // this is use to later balance CR&DR
    const equityTxID: string = randomUUID()
    const assetTxID: string = randomUUID()

    // fund transaction

    let equityTx: Transaction = {
        id: equityTxID,
        txid: txid,
        uid: requestBody.to,
        assetName: requestBody.asset,
        ts: "" + Date.now(),
        amount: "" + requestBody.amount,
        account: 'EQUITY',
        entryType: 'CR'
    }

    let assetTx: Transaction = {
        id: assetTxID,
        txid: txid,
        uid: requestBody.to,
        assetName: requestBody.asset,
        ts: "" + Date.now(),
        amount: "" + requestBody.amount,
        account: 'ASSET',
        entryType: 'DR'
    }

    let params: BatchWriteItemInput = {
        RequestItems: {
            "TransactionTable": [
                { PutRequest: mapTransactionToPutRequest(equityTx) },
                { PutRequest: mapTransactionToPutRequest(assetTx) }
            ]
        }
    };

    console.log("batchWriteItem", params)
    await ddb.batchWriteItem(params).promise();

    // balance state

    let equityCRState: BalanceState = {
        uid: requestBody.to,
        assetName: requestBody.asset,
        amount: "" + requestBody.amount,
        account: 'EQUITY',
        entryType: 'CR'
    }

    let assetDRState: BalanceState = {
        uid: requestBody.to,
        assetName: requestBody.asset,
        amount: "" + requestBody.amount,
        account: 'ASSET',
        entryType: 'DR'
    }

    console.log("Update EQUITY CR")
    let updateEQCRItem = {
        TableName: "BalanceStateTable",
        Key: { id: { S: mapBalanceStateToID(equityCRState) } },
        ExpressionAttributeValues: { ":inc": { N: equityTx.amount } },
        UpdateExpression: "ADD amount :inc"
    }
    const updateEQCRResponse = await ddb.updateItem(updateEQCRItem).promise()
    console.log("updateItem", updateEQCRItem)

    console.log("Update ASSET DR")
    let updateASTDRItem = {
        TableName: "BalanceStateTable",
        Key: { id: { S: mapBalanceStateToID(assetDRState) } },
        ExpressionAttributeValues: { ":inc": { N: assetTx.amount } },
        UpdateExpression: "ADD amount :inc"
    }
    const updateASTDRResponse = await ddb.updateItem(updateASTDRItem).promise()
    console.log("updateItem", updateASTDRItem)

    return [equityTx, assetTx]
}

const microFund = async (requestBody: FundRequest) => {
    const txid: string = randomUUID()         // this is use to later balance CR&DR
    const equityTxID: string = randomUUID()
    const assetTxID: string = randomUUID()
    let equityTx: Transaction = {
        id: equityTxID,
        txid: txid,
        uid: requestBody.to,
        assetName: requestBody.asset,
        ts: "" + Date.now(),
        amount: "" + requestBody.amount,
        account: 'EQUITY',
        entryType: 'CR'
    }

    let assetTx: Transaction = {
        id: assetTxID,
        txid: txid,
        uid: requestBody.to,
        assetName: requestBody.asset,
        ts: "" + Date.now(),
        amount: "" + requestBody.amount,
        account: 'ASSET',
        entryType: 'DR'
    }
    await dynamo.put({
        TableName: TRANSACTION_TABLE,
        Item: equityTx
    }).promise();

    await dynamo.put({
        TableName: TRANSACTION_TABLE,
        Item: assetTx
    }).promise();
    return [equityTx, assetTx]
}

export const lambdaHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    // All log statementimestamp are written to CloudWatch
    console.info('received:', event);


    let response: APIGatewayProxyResult;
    if (event.httpMethod == "POST") {
        let dbresponse;
        const body: FundRequest = JSON.parse(event.body as string);
        try {
            console.log("Init fund tx with request:", body)
            dbresponse = await fund(body)
            console.log("Funded with txs: ", dbresponse)
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
                message: `Method Not Allowed: expect POST, received ${event.httpMethod}`,
            }),
        };
    }
};
