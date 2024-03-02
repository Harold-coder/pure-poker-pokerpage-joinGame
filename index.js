const AWS = require('aws-sdk');
const Helpers = require('UpdateGame')
const dynamoDb = new AWS.DynamoDB.DocumentClient();
const tableName = process.env.GAME_TABLE;
const connectionsTableName = process.env.CONNECTIONS_TABLE;
const apiGatewayManagementApi = new AWS.ApiGatewayManagementApi({
    endpoint: process.env.WEBSOCKET_ENDPOINT // Set this environment variable to your WebSocket API endpoint.
});

exports.handler = async (event) => {
    const connectionId = event.requestContext.connectionId;
    const { gameId, playerId } = JSON.parse(event.body);

    try {
        const gameSessionResponse = await dynamoDb.get({
            TableName: tableName,
            Key: { gameId },
        }).promise();

        let gameSession = gameSessionResponse.Item;

        if (!gameSession) {
            return { statusCode: 404, body: JSON.stringify({ message: "Game session not found.", action: 'joinGame' }) };
        }

        if (gameSession.players.length >= gameSession.maxPlayers) {
            return { statusCode: 400, body: JSON.stringify({ message: "Maximum number of players reached.", action: 'joinGame' }) };
        }

        if (gameSession.gameInProgress) {
            gameSession.waitingPlayers.push(playerId);
            const updateConnectionParams = {
                TableName: connectionsTableName,
                Key: { connectionId: connectionId },
                UpdateExpression: "set gameId = :g, playerId = :p, waiting = :w",
                ExpressionAttributeValues: {
                    ":g": gameId,
                    ":p": playerId,
                    ":w": true // Mark this connection as waiting
                }
            };

            await dynamoDb.update(updateConnectionParams).promise();

            // Notify the player they are in waiting mode
            await apiGatewayManagementApi.postToConnection({
                ConnectionId: connectionId,
                Data: JSON.stringify({
                    action: 'waitingForNextGame',
                    message: 'You are in waiting mode. You will join the next game.'
                })
            }).promise();

            await dynamoDb.update({
                TableName: tableName,
                Key: { gameId },
                UpdateExpression: "SET waitingPlayers = :waitingPlayers",
                ExpressionAttributeValues: {
                    ':waitingPlayers': gameSession.waitingPlayers,
                },
                ReturnValues: 'ALL_NEW',
            }).promise();
        } else {
            const newPlayer = {
                id: playerId,
                position: gameSession.players.length,
                chips: gameSession.buyIn,
                bet: 0,
                inHand: true,
                isReady: false,
                hand: [],
                hasActed: false,
                potContribution: 0,
                isAllIn: false,
                amountWon: 0,
                handDescription: null,
                bestHand: null,
            };

            gameSession.players.push(newPlayer);
            gameSession.playerCount = gameSession.players.length;

            let message = "Player added successfully.";
            let updateExpression = 'SET players = :players, playerCount = :playerCount';
            let expressionAttributeValues = {
                ':players': gameSession.players,
                ':playerCount': gameSession.playerCount,
            };

            if (gameSession.players.length >= gameSession.minPlayers) {
                Helpers.setBlindsAndDeal(gameSession);
                gameSession.gameStarted = true;
                gameSession.gameInProgress = true;
                message += " Minimum number of players reached. Game started!";
                updateExpression = 'SET players = :players, playerCount = :playerCount, gameStarted = :gameStarted, pot = :pot, currentTurn = :currentTurn, gameStage = :gameStage, gameInProgress = :gameInProgress, deck = :deck, highestBet = :highestBet, bettingStarted = :bettingStarted';
                expressionAttributeValues[':gameStarted'] = gameSession.gameStarted;
                expressionAttributeValues[':pot'] = gameSession.pot;
                expressionAttributeValues[':currentTurn'] = gameSession.currentTurn;
                expressionAttributeValues[':gameStage'] = gameSession.gameStage;
                expressionAttributeValues[':players'] = gameSession.players;
                expressionAttributeValues[':gameInProgress'] = gameSession.gameInProgress;
                expressionAttributeValues[':deck'] = gameSession.deck;
                expressionAttributeValues[':highestBet'] = gameSession.highestBet;
                expressionAttributeValues[':bettingStarted'] = gameSession.bettingStarted;
            }

            await dynamoDb.update({
                TableName: tableName,
                Key: { gameId },
                UpdateExpression: updateExpression,
                ExpressionAttributeValues: expressionAttributeValues,
                ReturnValues: 'ALL_NEW',
            }).promise();

            // Assuming you've already added the player to the game session successfully

            const updateConnectionParams = {
                TableName: connectionsTableName,
                Key: { connectionId: connectionId },
                UpdateExpression: "set gameId = :g, playerId = :p",
                ExpressionAttributeValues: {
                    ":g": gameId,
                    ":p": playerId
                }
            };

            try {
                await dynamoDb.update(updateConnectionParams).promise();
                console.log("Connection updated with gameId and playerId.");
            } catch (error) {
                console.error("Failed to update connection:", error);
                // Handle error accordingly
            }


            const updatedGameState = { ...gameSession };

            // Retrieve all connections for this game
            const connectionData = await dynamoDb.scan({
                TableName: connectionsTableName,
                FilterExpression: "gameId = :gameId",
                ExpressionAttributeValues: {
                ":gameId": gameId
                }
            }).promise();

            // Iterate over each connection and post the updated game state
            const postCalls = connectionData.Items.map(async ({ connectionId }) => {
                try {
                await apiGatewayManagementApi.postToConnection({
                    ConnectionId: connectionId,
                    Data: JSON.stringify({
                    action: 'updateGameState',
                    gameDetails: updatedGameState,
                    statusCode: 200
                    })
                }).promise();
                } catch (error) {
                if (error.statusCode === 410) {
                    console.log(`Found stale connection, deleting ${connectionId}`);
                    await dynamoDb.delete({ TableName: connectionsTableName, Key: { connectionId } }).promise();
                } else {
                    throw error;
                }
                }
            });
            
            try {
                await Promise.all(postCalls);
                console.log('Game state updated and pushed to all players.');
            } catch (error) {
                return { statusCode: 500, body: JSON.stringify({ message: "Failed to broadcast game state." }) };
            }

            await apiGatewayManagementApi.postToConnection({
                ConnectionId: connectionId,
                Data: JSON.stringify({
                    message: 'Player joined successfully',
                    action: 'joinGame',
                    gameDetails: gameSession,
                    statusCode: 200
                })
            }).promise();

            return {
                statusCode: 200,
                body: JSON.stringify({ message }),
            };
        }
    } catch (error) {
        console.error('Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Failed to join game", action: 'joinGame' }),
        };
    }
};