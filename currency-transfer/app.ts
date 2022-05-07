import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDB } from 'aws-sdk';
import { PutRequest, BatchWriteItemInput } from 'aws-sdk/clients/dynamodb';
import { randomUUID } from 'crypto';

let TRANSACTION_TABLE: string = process.env.TRANSACTION_TABLE ??= "TransactionTable"

const dynamo = new DynamoDB.DocumentClient();
const ddb = new DynamoDB({apiVersion: '2012-08-10'});


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

interface TransferRequest {
    asset: string,
    from: string,
    to: string,
    amount: number,
}

interface BalanceState {
    id?: string,            // object id
    uid: string,           // uid uid
    assetName: string,     // asset class
    amount: string,        // amount
    account: string,       // double entry account 
    entryType: string      // Credit: CR , Debit: DR
}

const mapBalanceStateToID = (balanceState: BalanceState) => {
    return `${balanceState.uid}_${balanceState.account}_${balanceState.assetName}_${balanceState.entryType}`
}

const parseTransactionToPutRequest = (transaction: Transaction): PutRequest => {
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

const transfer = async (requestBody: TransferRequest): Promise<Transaction[]> => {
    const txid: string = randomUUID()         // this is use to later balance CR&DR

    const senderAssetTxID: string = randomUUID()
    const receiverAssetTxID: string = randomUUID()

    const senderExpenseTxID: string = randomUUID()
    const receiverIncomexID: string = randomUUID()

    let senderAssetTx: Transaction = {
        id: senderAssetTxID,
        txid: txid,
        uid: requestBody.from,
        assetName: requestBody.asset,
        ts: "" + Date.now(),
        amount: "" + requestBody.amount,
        account: 'ASSET',
        entryType: 'CR'
    }

    let receiverAssetTx: Transaction = {
        id: receiverAssetTxID,
        txid: txid,
        uid: requestBody.to,
        assetName: requestBody.asset,
        ts: "" + Date.now(),
        amount: "" + requestBody.amount,
        account: 'ASSET',
        entryType: 'DR'
    }

    let senderExpenseTx: Transaction = {
        id: senderExpenseTxID,
        txid: txid,
        uid: requestBody.from,
        assetName: requestBody.asset,
        ts: "" + Date.now(),
        amount: "" + requestBody.amount,
        account: 'EXPENSE',
        entryType: 'DR'
    }

    let receiverIncomTx: Transaction = {
        id: receiverIncomexID,
        txid: txid,
        uid: requestBody.to,
        assetName: requestBody.asset,
        ts: "" + Date.now(),
        amount: "" + requestBody.amount,
        account: 'INCOME',
        entryType: 'CR'
    }

    let params: BatchWriteItemInput = {
        RequestItems: {
            "TransactionTable": [
                { PutRequest: parseTransactionToPutRequest(senderAssetTx) },
                { PutRequest: parseTransactionToPutRequest(senderExpenseTx) },
                { PutRequest: parseTransactionToPutRequest(receiverAssetTx) },
                { PutRequest: parseTransactionToPutRequest(receiverIncomTx) }
            ]
        }
    };

    await ddb.batchWriteItem(params).promise();
    console.log("batchWriteItem", params)

    // balance state

    let senderAssetCRState: BalanceState = {
        uid: senderAssetTx.uid,
        assetName: senderAssetTx.assetName,
        amount: "" + senderAssetTx.amount,
        account: 'ASSET',
        entryType: 'CR'
    }

    console.log("Update Sender ASSET CR")
    let updateEQCRItem = {
        TableName: "BalanceStateTable",
        Key: { id: { S: mapBalanceStateToID(senderAssetCRState) } },
        ExpressionAttributeValues: { ":inc": { N: senderAssetTx.amount } },
        UpdateExpression: "ADD amount :inc"
    }
    const updateEQCRResponse = await ddb.updateItem(updateEQCRItem).promise()
    console.log("updateItem", updateEQCRItem)


    let receiverAssetDRState: BalanceState = {
        uid: receiverAssetTx.uid,
        assetName: receiverAssetTx.assetName,
        amount: "" + receiverAssetTx.amount,
        account: 'ASSET',
        entryType: 'DR'
    }

    console.log("Update Receiver ASSET DR")
    let updateASTDRItem = {
        TableName: "BalanceStateTable",
        Key: { id: { S: mapBalanceStateToID(receiverAssetDRState) } },
        ExpressionAttributeValues: { ":inc": { N: receiverAssetTx.amount } },
        UpdateExpression: "ADD amount :inc"
    }
    const updateASTDRResponse = await ddb.updateItem(updateASTDRItem).promise()
    console.log("updateItem", updateASTDRItem)


    return [ senderAssetTx, senderExpenseTx, receiverAssetTx, receiverIncomTx]
}

export const lambdaHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    // All log statementimestamp are written to CloudWatch
    console.info('received:', event);
    

    let response: APIGatewayProxyResult;
    if (event.httpMethod == "POST") {
        let dbresponse;
        const body: TransferRequest = JSON.parse(event.body as string);
        try {
            console.log("Init transfer tx with request:", body)
            dbresponse = await transfer(body)
            console.log("Transferred with txs: ", dbresponse)
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
