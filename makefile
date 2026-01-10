CC = em++
# Adicionamos malloc e free nos métodos exportados
# Note que usamos EXPORTED_FUNCTIONS com underline e EXPORTED_RUNTIME_METHODS para helpers do JS
CFLAGS = -O3 --bind -s WASM=1 -s ALLOW_MEMORY_GROWTH=1 \
         -s MODULARIZE=1 -s EXPORT_NAME="'VoxEngine'" \
         -s EXPORTED_FUNCTIONS='["_malloc", "_free"]' \
         -s EXPORTED_RUNTIME_METHODS='["ccall", "cwrap"]'
         
SRC_DIR = core
BUILD_DIR = build
SOURCES = $(SRC_DIR)/dsp_engine.cpp $(SRC_DIR)/pitch_detection.cpp
OUTPUT = $(BUILD_DIR)/vox_engine.js

# Detecção de OS para comandos de terminal
ifeq ($(OS),Windows_NT)
    # No Windows (CMD), usamos comandos nativos
    MKDIR = if not exist $(BUILD_DIR) mkdir $(BUILD_DIR)
    RM = if exist $(BUILD_DIR) rmdir /s /q $(BUILD_DIR)
else
    # No Linux/Mac/Git Bash
    MKDIR = mkdir -p $(BUILD_DIR)
    RM = rm -rf $(BUILD_DIR)
endif

all: $(OUTPUT)

$(OUTPUT): $(SOURCES)
	$(MKDIR)
	$(CC) $(CFLAGS) $(SOURCES) -o $(OUTPUT)
	@echo "Build complete: $(OUTPUT)"

clean:
	$(RM)