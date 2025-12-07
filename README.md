# Crypto Trading Backend

This is the backend for a crypto trading application. It includes features for user authentication, balance management, trading, and a user verification system.

## Features

*   User registration and authentication (JWT-based)
*   Real-time price updates via WebSockets
*   Asset and transaction management
*   User balance tracking
*   Conditional order support
*   Admin-managed user identity verification (KYC)
*   Secure handling of user data

## Getting Started

### Prerequisites

*   [Node.js](https://nodejs.org/) (v14 or later)
*   [MongoDB](https://www.mongodb.com/)
*   A package manager like [npm](https://www.npmjs.com/)

### Installation

1.  Clone the repository:
    ```bash
    git clone https://github.com/yourname/crypto-trading-backend.git
    cd crypto-trading-backend
    ```

2.  Install the dependencies:
    ```bash
    npm install
    ```

### Configuration

1.  Create a `.env` file in the root of the project.
2.  Add the following environment variables:

    ```env
    MONGO_URI=your_mongodb_connection_string
    JWT_SECRET=your_jwt_secret
    FRONTEND_ORIGIN=http://localhost:3000
    PORT=5000
    ```

### Running the Application

*   To run the server in production mode:
    ```bash
    npm start
    ```

*   To run the server in development mode with auto-reloading (`nodemon`):
    ```bash
    npm run dev
    ```

The server will be running on the port specified in your `.env` file (default is 5000).

## API Documentation

The API is structured into several modules based on functionality.

### User Verification API

This API provides a workflow for user identity verification, managed by an administrator.

#### Verification Workflow

1.  An authenticated user submits an ID document (e.g., a photo of a driver's license) via the `POST /api/users/me/submit-verification` endpoint. The user's verification status is changed to `pending`.
2.  An administrator retrieves a list of all users with a `pending` verification status using the `GET /api/admin/users/pending-verification` endpoint.
3.  The administrator reviews the submitted document and approves or rejects the verification request using the `PUT /api/admin/users/:userId/verify` endpoint.
4.  The user's verification status is updated to `verified` or `rejected`.

#### User Model Changes

The `User` model has been updated with the following fields to support verification:

*   `verification`: An object containing:
    *   `status` (String): The user's verification status. Can be `unverified`, `pending`, `verified`, or `rejected`. Defaults to `unverified`.
    *   `idPhoto` (String): A data URI containing the uploaded ID document.
    *   `rejectionReason` (String): A reason for why the verification was rejected.
*   `twoFactor`: An object for 2FA (Two-Factor Authentication):
    *   `enabled` (Boolean): Whether 2FA is enabled. Defaults to `false`.
    *   `secret` (String): The 2FA secret key.

#### Endpoints

**User Endpoint**

*   **Submit Verification Document**
    *   **Method**: `POST`
    *   **Path**: `/api/users/me/submit-verification`
    *   **Access**: Private (requires user authentication)
    *   **Description**: Allows a user to submit an ID document for verification. The request body must be `multipart/form-data` with a single file field named `idPhoto`.
    *   **Success Response**: `200 OK` with a confirmation message.
    *   **Error Responses**: `400 Bad Request` if no file is uploaded, or if verification is already pending/verified.

**Admin Endpoints**

*   **Get Pending Verifications**
    *   **Method**: `GET`
    *   **Path**: `/api/admin/users/pending-verification`
    *   **Access**: Private (requires admin privileges)
    *   **Description**: Retrieves a list of all users whose verification status is `pending`.
    *   **Success Response**: `200 OK` with an array of user objects.

*   **Verify or Reject a User**
    *   **Method**: `PUT`
    *   **Path**: `/api/admin/users/:userId/verify`
    *   **Access**: Private (requires admin privileges)
    *   **Description**: Updates a user's verification status.
    *   **Request Body**:
        ```json
        {
          "status": "verified"
        }
        ```
        or
        ```json
        {
          "status": "rejected",
          "rejectionReason": "The ID document was not clear."
        }
        ```
    *   **Success Response**: `200 OK` with the updated user object.
    *   **Error Responses**: `400 Bad Request` for invalid status or missing rejection reason. `404 Not Found` if the user does not exist.
