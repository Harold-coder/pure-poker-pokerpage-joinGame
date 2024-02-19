const AWS = require('aws-sdk');
const dynamoDb = new AWS.DynamoDB.DocumentClient();
const tableName = process.env.GAME_TABLE;
const { setBlindsAndDeal } = require('/opt/nodejs/node_modules/gameUtils');

exports.handler = async (event) => {
    const { gameId, playerId } = JSON.parse(event.body);

    try {
        const gameSessionResponse = await dynamoDb.get({
            TableName: tableName,
            Key: { gameId },
        }).promise();

        let gameSession = gameSessionResponse.Item;

        if (!gameSession) {
            return { statusCode: 404, body: JSON.stringify({ message: "Game session not found." }) };
        }

        if (gameSession.gameInProgress) {
            return { statusCode: 403, body: JSON.stringify({ message: "Game is already in progress. You can only spectate." }) };
        }

        if (gameSession.players.length >= gameSession.maxPlayers) {
            return { statusCode: 400, body: JSON.stringify({ message: "Maximum number of players reached." }) };
        }

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
            gameSession = setBlindsAndDeal(gameSession);
            gameSession.gameStarted = true;
            gameSession.gameInProgress = true;
            message += " Minimum number of players reached. Game started!";
            updateExpression += ', gameStarted = :gameStarted, pot = :pot, currentTurn = :currentTurn, gameStage = :gameStage';
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

        return {
            statusCode: 200,
            body: JSON.stringify({ message }),
        };
    } catch (error) {
        console.error('Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Failed to join game" }),
        };
    }
};