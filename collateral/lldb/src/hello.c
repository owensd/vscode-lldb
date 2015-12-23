#include <stdio.h>

int sum(int x, int y);

int main(int argc, char** argv)
{
	printf("just a simple test app.\n");
	int x = 0;
	int y = 0;
	
	for (int i = 0; i < 10; ++i) {
		for (int j = 0; j < 10; ++j) {
			x += i + j;
		}
		
		y += i;
	}
	
	printf("%d + %d = %d\n", x, y, sum(x, y));
}

int sum(int x, int y)
{
	int result = x + y;
	return result;
}
