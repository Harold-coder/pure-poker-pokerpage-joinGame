const AWS = require('aws-sdk');
const dynamoDb = new AWS.DynamoDB.DocumentClient();
const tableName = process.env.GAME_TABLE;

exports.handler = async (event) => {
  const { gameId, playerId } = JSON.parse(event.body); // Assuming playerId is passed in the request

  // Retrieve the game session by gameId
  try {
    const gameSessionResponse = await dynamoDb.get({
      TableName: tableName,
      Key: { gameId },
    }).promise();

    const gameSession = gameSessionResponse.Item;

    // Check if the game session exists
    if (!gameSession) {
      return { statusCode: 404, body: JSON.stringify({ message: "Game session not found." }) };
    }

    // Check if the maximum number of players has been reached
    if (gameSession.players.length >= gameSession.maxPlayers) {
      return { statusCode: 400, body: JSON.stringify({ message: "Maximum number of players reached." }) };
    }

    // Create a new player object
    const newPlayer = {
      id: playerId,
      position: gameSession.players.length, // Assigning position based on the current length
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

    // Add new player to game session
    gameSession.players.push(newPlayer);

    // Update player count
    gameSession.playerCount = gameSession.players.length;

    // Update the game session in DynamoDB
    await dynamoDb.update({
      TableName: tableName,
      Key: { gameId },
      UpdateExpression: 'SET players = :players, playerCount = :playerCount',
      ExpressionAttributeValues: {
        ':players': gameSession.players,
        ':playerCount': gameSession.playerCount,
      },
      ReturnValues: 'ALL_NEW',
    }).promise();

    let message = "Player added successfully.";
    // Check if the minimum number of players has been met and potentially initialize the game
    if (gameSession.players.length >= gameSession.minPlayers) {
      // Initialize game logic here (to be implemented)
      message += " Minimum number of players reached. Initializing game...";
    }

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
