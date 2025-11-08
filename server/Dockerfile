# Use Playwright base image with Node.js 20 and browsers preinstalled
FROM mcr.microsoft.com/playwright:v1.56.1-jammy

# Set the working directory in the container
WORKDIR /root/app

# Copy package.json and package-lock.json to the working directory
COPY package*.json ./

# Install any needed packages
RUN npm install

# Bundle app source
COPY . .

# Make port 3001 available to the world outside this container
EXPOSE 3001

# Define the command to run the app
CMD ["node", "app.js"]
